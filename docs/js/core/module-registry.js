// Consumers receive transport methods and lifecycle events, never raw WebRTC objects.
export class ModuleRegistry {
    constructor(transport) {
        this.transport = transport;
        this.modules = new Map();
        transport.addEventListener('message', ({ detail }) => {
            if (detail && typeof detail.module === 'string') this.modules.get(detail.module)?.onMessage?.(detail);
        });
        for (const event of ['connected', 'disconnected']) {
            transport.addEventListener(event, () => {
                for (const module of this.modules.values()) module.onConnectionChange?.(transport.connected);
            });
        }
    }
    registerModule(module) {
        if (!module || typeof module.id !== 'string' || !module.id || typeof module.init !== 'function' || this.modules.has(module.id))
            throw new Error('Modules require a unique id and an init function.');
        const send = payload => this.transport.send({ ...payload, module: module.id });
        module.send = send;
        module.init({ send, connected: () => this.transport.connected });
        this.modules.set(module.id, module);
        module.onConnectionChange?.(this.transport.connected);
        return () => { module.destroy?.(); this.modules.delete(module.id); };
    }
}
