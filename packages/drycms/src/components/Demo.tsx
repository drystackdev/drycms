import { useMemo } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import Prism from 'prismjs';

/**
 * One showcase entry: a live preview plus the markup that produced it. The
 * code is always visible - this page is a reference, not a puzzle to click
 * through.
 */
interface Props {
	id: string;
	title: string;
	description?: string;
	code: string;
	/** Prism grammar to highlight with. @default "markup" */
	lang?: string;
	children?: ComponentChildren;
}

export default function Demo({ id, title, description, code, lang = 'markup', children }: Props) {
	const grammar = Prism.languages[lang] ? lang : 'markup';
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
