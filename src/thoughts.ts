import type { ThoughtBoundary } from './notebook-store';

interface SubmittedThought {
	appended: boolean;
	rawThought: string;
	thoughts: ThoughtBoundary[];
}

interface CleanedThought {
	text: string;
	thoughts: ThoughtBoundary[];
	start: number;
	end: number;
	replacement: string;
}

function withoutTerminatingNewline(text: string) {
	return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export function appendThought(
	previousText: string,
	previousThoughts: ThoughtBoundary[],
	submittedText: string,
	thoughtId: string
): SubmittedThought {
	const appended = submittedText.startsWith(previousText);
	const rawSegment = appended ? submittedText.slice(previousText.length) : submittedText;
	const rawThought = withoutTerminatingNewline(rawSegment);
	const thought = { id: thoughtId, end: submittedText.length, originalText: rawThought };
	return {
		appended,
		rawThought,
		thoughts: appended ? [...previousThoughts.map((item) => ({ ...item })), thought] : [thought]
	};
}

export function applyThoughtCleanup(
	text: string,
	thoughts: ThoughtBoundary[],
	thoughtId: string,
	cleaned: string
): CleanedThought {
	const thoughtIndex = thoughts.findIndex((thought) => thought.id === thoughtId);
	if (thoughtIndex < 0) throw new Error('Thought does not exist.');
	const thought = thoughts[thoughtIndex]!;
	const start = thoughtIndex === 0 ? 0 : thoughts[thoughtIndex - 1]!.end;
	const end = thought.end;
	const terminator = text.slice(start, end).endsWith('\n') ? '\n' : '';
	const replacement = `${cleaned}${terminator}`;
	const difference = replacement.length - (end - start);
	const updatedThoughts = thoughts.map((item, index) => ({
		...item,
		end: index >= thoughtIndex ? item.end + difference : item.end
	}));
	return {
		text: `${text.slice(0, start)}${replacement}${text.slice(end)}`,
		thoughts: updatedThoughts,
		start,
		end,
		replacement
	};
}
