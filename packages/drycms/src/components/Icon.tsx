import { type IconName, iconBodies, iconViewBoxes } from './icons.js';

interface Props {
	name: IconName;
	size?: string;
	[key: string]: unknown;
}

export default function Icon({ name, size = '1em', ...rest }: Props) {
	const body = iconBodies[name];
	if (!body) {
		throw new Error(
			`[drycms] Unknown icon "${name}". Available: ${Object.keys(iconBodies).join(', ')}`,
		);
	}

	return (
		<svg
			viewBox={iconViewBoxes[name]}
			width={size}
			height={size}
			aria-hidden="true"
			{...rest}
			dangerouslySetInnerHTML={{ __html: body }}
		/>
	);
}
