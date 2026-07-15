import { describe, expect, it, vi } from 'vitest';
import { initializePwaUpdates } from './pwa-updates';

class Events {
	listeners = new Map<string, Array<() => void>>();
	addEventListener(name: string, listener: () => void) {
		this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
	}
	removeEventListener(name: string, listener: () => void) {
		this.listeners.set(name, (this.listeners.get(name) ?? []).filter((item) => item !== listener));
	}
	emit(name: string) {
		for (const listener of this.listeners.get(name) ?? []) listener();
	}
}

class Element {
	children: Element[] = [];
	attributes = new Map<string, string>();
	listeners = new Map<string, () => void>();
	hidden = false;
	textContent = '';
	append(...children: Element[]) { this.children.push(...children); }
	setAttribute(name: string, value: string) { this.attributes.set(name, value); }
	addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
	click() { this.listeners.get('click')?.(); }
	remove() {}
}

describe('AgenticScribe PWA updates', () => {
	it('uses the shared package to register and present an accepted waiting update', async () => {
		const worker = new Events() as Events & { postMessage: ReturnType<typeof vi.fn> };
		worker.postMessage = vi.fn();
		const registration = new Events() as Events & { waiting: typeof worker; installing: null; update(): Promise<void> };
		registration.waiting = worker;
		registration.installing = null;
		registration.update = async () => {};
		const serviceWorker = new Events() as Events & { controller: object; register: ReturnType<typeof vi.fn> };
		serviceWorker.controller = {};
		serviceWorker.register = vi.fn(async () => registration);
		const body = new Element();
		const document = { body, createElement: () => new Element() };
		const reload = vi.fn();

		const updates = await initializePwaUpdates({
			serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
			document: document as unknown as Document,
			reload
		});

		expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js');
		expect(updates.prompt.element.hidden).toBe(false);
		expect(updates.prompt.updateButton.textContent).toBe('Update AgenticScribe');
		updates.prompt.updateButton.click();
		expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
		serviceWorker.emit('controllerchange');
		expect(reload).toHaveBeenCalledOnce();
	});
});
