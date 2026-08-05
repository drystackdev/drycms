import { type IconName, iconBodies } from './icons/index.js';

interface Props {
	name: IconName;
	size?: string;
	[key: string]: unknown;
}

const DEFAULT_VIEW_BOX = '0 0 24 24';

export default function Icon({ name, size = '1em', ...rest }: Props) {
	const icon = iconBodies[name];
	if (!icon) {
		throw new Error(
			`[drycms] Unknown icon "${name}". Available: ${Object.keys(iconBodies).join(', ')}`,
		);
	}
	const { body, viewBox = DEFAULT_VIEW_BOX } = icon;

	return (
		<svg
			viewBox={viewBox}
			width={size}
			height={size}
			aria-hidden="true"
			{...rest}
			dangerouslySetInnerHTML={{ __html: body }}
		/>
	);
}
