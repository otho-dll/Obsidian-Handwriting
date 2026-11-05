// Component and Events – the lifecycle base classes of Obsidian (plugins, views, …).

export interface EventRef { e: Events; name: string; fn: (...args: unknown[]) => unknown; }

export class Events {
    private handlers = new Map<string, Set<(...args: unknown[]) => unknown>>();
    on(name: string, fn: (...args: unknown[]) => unknown): EventRef {
        let set = this.handlers.get(name);
        if (!set) this.handlers.set(name, set = new Set());
        set.add(fn);
        return { e: this, name, fn };
    }
    off(name: string, fn: (...args: unknown[]) => unknown) { this.handlers.get(name)?.delete(fn); }
    offref(ref: EventRef) { this.off(ref.name, ref.fn); }
    trigger(name: string, ...args: unknown[]) {
        for (const fn of [...(this.handlers.get(name) ?? [])]) {
            try { fn(...args); } catch (e) { console.error(e); }
        }
    }
}

export class Component {
    private _loaded = false;
    private _cleanups: (() => void)[] = [];
    private _children: Component[] = [];

    load() {
        if (this._loaded) return;
        this._loaded = true;
        void this.onload();   // an async onload() is awaited only by loadAsync()
        this._children.forEach(c => c.load());
    }
    /** Like load(), but waits for an async onload() (used for the plugin). */
    async loadAsync() {
        if (this._loaded) return;
        this._loaded = true;
        await this.onload();
        this._children.forEach(c => c.load());
    }
    unload() {
        if (!this._loaded) return;
        this._loaded = false;
        this._children.forEach(c => c.unload());
        this._children = [];
        const fns = this._cleanups.splice(0).reverse();
        for (const fn of fns) { try { fn(); } catch (e) { console.error(e); } }
        this.onunload();
    }
    onload(): void | Promise<void> { /* overridden */ }
    onunload(): void { /* overridden */ }

    addChild<T extends Component>(c: T): T { this._children.push(c); if (this._loaded) c.load(); return c; }
    removeChild<T extends Component>(c: T): T { this._children = this._children.filter(x => x !== c); c.unload(); return c; }

    register(fn: () => unknown) { this._cleanups.push(fn); }
    registerEvent(ref: EventRef) { this.register(() => ref.e.offref(ref)); }
    registerDomEvent(el: Window | Document | HTMLElement, type: string, fn: (e: unknown) => unknown, options?: boolean | AddEventListenerOptions) {
        el.addEventListener(type, fn, options);
        this.register(() => el.removeEventListener(type, fn, options));
    }
    registerInterval(id: number): number { this.register(() => window.clearInterval(id)); return id; }
}
