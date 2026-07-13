import { describe, expect, it } from 'vitest';
import { appendThought, applyThoughtCleanup } from './thoughts';

describe('thought updates', () => {
	it('appends only the newly submitted thought and preserves its original text', () => {
		const update = appendThought(
			'Existing thought.\n',
			[{ id: 'thought-1', end: 18, originalText: 'Existing thought.' }],
			'Existing thought.\nthis have bad grammer.\n',
			'thought-2'
		);

		expect(update.rawThought).toBe('this have bad grammer.');
		expect(update.appended).toBe(true);
		expect(update.thoughts.at(-1)).toEqual({
			id: 'thought-2',
			end: 41,
			originalText: 'this have bad grammer.'
		});
	});

	it('replaces the cleaned thought while retaining the raw original and later boundaries', () => {
		const update = applyThoughtCleanup(
			'this have bad grammer.\nLater thought.\n',
			[
				{ id: 'thought-1', end: 23, originalText: 'this have bad grammer.' },
				{ id: 'thought-2', end: 38, originalText: 'Later thought.' }
			],
			'thought-1',
			'This has bad grammar.'
		);

		expect(update).toEqual({
			text: 'This has bad grammar.\nLater thought.\n',
			thoughts: [
				{ id: 'thought-1', end: 22, originalText: 'this have bad grammer.' },
				{ id: 'thought-2', end: 37, originalText: 'Later thought.' }
			],
			start: 0,
			end: 23,
			replacement: 'This has bad grammar.\n'
		});
	});
});
