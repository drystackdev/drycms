import type { ComponentChildren } from 'preact';
import CodeBlock from './CodeBlock.js';

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
	children?: ComponentChildren;
}

export default function Demo({ id, title, description, code, children }: Props) {
	return (
		<section id={id} class="demo">
			<header>
				<h3>{title}</h3>
				{description && <p>{description}</p>}
			</header>

			<div class="demo-preview">{children}</div>

			<div class="demo-code">
				<span>Code</span>
				<CodeBlock editable code={code} />
			</div>
		</section>
	);
}
