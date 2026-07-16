import { describe, expect, it, vi } from 'vitest';
import { VoiceRecorder } from './voice-recorder';

describe('VoiceRecorder', () => {
	it('records independent bounded segments and retains them until stopped', async () => {
		type FakeRecorder = {
			start: () => void;
			stop: () => void;
			ondataavailable: ((event: { data: Blob }) => void) | null;
			onstop: (() => void) | null;
		};
		const track = { stop: vi.fn() };
		const stream = { getTracks: () => [track] } as unknown as MediaStream;
		const timers: Array<() => void> = [];
		const recorders: FakeRecorder[] = [];
		const recorder = new VoiceRecorder({
			mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
			createRecorder: () => {
				const instance: FakeRecorder = {
					start: vi.fn(),
					stop: vi.fn(function (this: FakeRecorder) {
						this.ondataavailable?.({ data: new Blob([`segment-${recorders.length}`], { type: 'audio/webm' }) });
						this.onstop?.();
					}),
					ondataavailable: null,
					onstop: null
				};
				recorders.push(instance);
				return instance;
			},
			setTimer: (callback) => {
				timers.push(callback);
				return timers.length;
			},
			clearTimer: vi.fn(),
			segmentMilliseconds: 25_000
		});

		await recorder.start();
		expect(recorders).toHaveLength(1);
		expect(recorders[0]!.start).toHaveBeenCalledOnce();

		timers[0]!();
		await Promise.resolve();
		expect(recorders).toHaveLength(2);

		const segments = await recorder.stop();
		expect(segments).toHaveLength(2);
		expect(segments.every((segment) => segment.type === 'audio/webm')).toBe(true);
		expect(track.stop).toHaveBeenCalledOnce();
	});
});
