interface RecorderLike {
	start(): void;
	stop(): void;
	ondataavailable: ((event: { data: Blob }) => void) | null;
	onstop: (() => void) | null;
}

interface VoiceRecorderOptions {
	mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
	createRecorder?: (stream: MediaStream) => RecorderLike;
	setTimer?: (callback: () => void, milliseconds: number) => number;
	clearTimer?: (timer: number) => void;
	segmentMilliseconds?: number;
}

export class VoiceRecorder {
	readonly #mediaDevices: Pick<MediaDevices, 'getUserMedia'>;
	readonly #createRecorder: (stream: MediaStream) => RecorderLike;
	readonly #setTimer: (callback: () => void, milliseconds: number) => number;
	readonly #clearTimer: (timer: number) => void;
	readonly #segmentMilliseconds: number;
	#stream?: MediaStream;
	#recorder?: RecorderLike;
	#timer?: number;
	#recording = false;
	#segments: Blob[] = [];
	#segmentFinished: Promise<void> = Promise.resolve();

	constructor(options: VoiceRecorderOptions = {}) {
		this.#mediaDevices = options.mediaDevices ?? navigator.mediaDevices;
		this.#createRecorder = options.createRecorder ?? ((stream) => new MediaRecorder(stream) as unknown as RecorderLike);
		this.#setTimer = options.setTimer ?? ((callback, milliseconds) => window.setTimeout(callback, milliseconds));
		this.#clearTimer = options.clearTimer ?? ((timer) => window.clearTimeout(timer));
		this.#segmentMilliseconds = options.segmentMilliseconds ?? 25_000;
	}

	async start() {
		if (this.#recording) return;
		this.#stream = await this.#mediaDevices.getUserMedia({ audio: true });
		this.#segments = [];
		this.#recording = true;
		this.#beginSegment();
	}

	async stop() {
		if (!this.#recording) return [...this.#segments];
		this.#recording = false;
		if (this.#timer !== undefined) this.#clearTimer(this.#timer);
		this.#recorder?.stop();
		await this.#segmentFinished;
		this.#stream?.getTracks().forEach((track) => track.stop());
		this.#stream = undefined;
		return [...this.#segments];
	}

	#beginSegment() {
		if (!this.#stream || !this.#recording) return;
		const chunks: Blob[] = [];
		const recorder = this.#createRecorder(this.#stream);
		this.#recorder = recorder;
		this.#segmentFinished = new Promise((resolve) => {
			recorder.ondataavailable = ({ data }) => {
				if (data.size) chunks.push(data);
			};
			recorder.onstop = () => {
				if (chunks.length) this.#segments.push(new Blob(chunks, { type: chunks[0]!.type }));
				resolve();
				if (this.#recording) this.#beginSegment();
			};
		});
		recorder.start();
		this.#timer = this.#setTimer(() => recorder.stop(), this.#segmentMilliseconds);
	}
}
