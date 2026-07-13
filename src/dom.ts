export function requireElement<T extends Element>(selector: string, root: ParentNode = document): T {
	const element = root.querySelector<T>(selector);
	if (!element) throw new Error(`Required interface element is missing: ${selector}`);
	return element;
}
