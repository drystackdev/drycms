import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import Prism from 'prismjs';
import PrismLive from '@victr/prism-live';
import LivePrismCore from '@victr/prism-live/prism';
import markupLanguage from '@victr/prism-live/language/markup';
import '@victr/prism-live/style.css';

const livePrism = new LivePrismCore();
livePrism.addLanguage(markupLanguage);
PrismLive.addPrism(livePrism);

type Props = { id: string; title: string; description?: string; lang?: string } & (
	| {
			/** Static reference sample; `children` is the real, separately-authored preview. */
			code: string;
			html?: never;
			children: ComponentChildren;
	  }
	| {
			/** Live-editable HTML: also drives the preview directly, and can be reset. */
			html: string;
			code?: never;
			children?: never;
	  }
);

/**
 * One showcase entry: a live preview plus the markup that produced it. The
 * code is always visible - this page is a reference, not a puzzle to click
 * through.
 */
export default function Demo(props: Props) {
	const { id, title, description, lang = 'markup' } = props;
	const grammar = Prism.languages[lang] ? lang : 'markup';

	if (props.html !== undefined) {
		return (
			<EditableDemo id={id} title={title} description={description} grammar={grammar} html={props.html} />
		);
	}

	const { code, children } = props;
	const highlighted = useMemo(
		() => Prism.highlight(code.trim(), Prism.languages[grammar]!, grammar),
		[code, grammar],
	);

	return (
		<section id={id} class="demo">
			<header>
				<h3>{title}</h3>
				{description && <p>{description}</p>}
			</header>

			<div class="demo-preview">{children}</div>

			<div class="demo-code">
				<span>Code</span>
				<pre class={`language-${grammar}`}>
					<code dangerouslySetInnerHTML={{ __html: highlighted }} />
				</pre>
			</div>
		</section>
	);
}

interface EditableProps {
	id: string;
	title: string;
	description?: string;
	grammar: string;
	html: string;
}

function EditableDemo({ id, title, description, grammar, html }: EditableProps) {
	const [liveHtml, setLiveHtml] = useState(html);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const instanceRef = useRef<PrismLive | null>(null);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		instanceRef.current = PrismLive.create(el);
		const onInput = () => setLiveHtml(el.value);
		el.addEventListener('input', onInput);
		return () => el.removeEventListener('input', onInput);
	}, []);

	function reset() {
		const el = textareaRef.current;
		if (!el || !instanceRef.current) return;
		el.value = html;
		instanceRef.current.update(true);
		setLiveHtml(html);
	}

	return (
		<section id={id} class="demo">
			<header>
				<h3>{title}</h3>
				{description && <p>{description}</p>}
			</header>

			<div class="demo-preview" dangerouslySetInnerHTML={{ __html: liveHtml }} />

			<div class="demo-code">
				<div class="row justify-between">
					<span>Code</span>
					<button type="button" class="sm ghost" onClick={reset}>
						Reset
					</button>
				</div>
				<textarea
					ref={textareaRef}
					class={`prism-live language-${grammar}`}
					defaultValue={html}
					spellcheck={false}
				/>
			</div>
		</section>
	);
}
