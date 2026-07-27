import { useId, useRef, useState } from 'preact/hooks';
import { ArrowDownIcon, CheckIcon } from './icons.js';
import {
	firstEnabledIndex,
	lastEnabledIndex,
	matchTypeahead,
	nextEnabledIndex,
	printableChar,
	useCloseOnBlur,
	useFloatingPosition,
	useNativePopover,
	useOutsideClick,
	usePopupFlip,
	useScrollLock,
	useTypeahead,
	type ListOption,
} from './list-nav.js';
import { useOverlayScrollbars } from './overlayscrollbars.js';

export type SelectOption = ListOption;

export interface SelectProps {
	options: SelectOption[];
	value?: string;
	defaultValue?: string;
	onChange?: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	invalid?: boolean;
	name?: string;
	id?: string;
}

/**
 * Custom-styled single select. Keyboard model follows the ARIA APG
 * "collapsible listbox" pattern: focus moves into the popup on open and
 * roves between `role="option"` elements, instead of `aria-activedescendant`
 * - which is only needed when focus must stay on a text input (see Combobox).
 */
export default function Select({
	options,
	value,
	defaultValue,
	onChange,
	placeholder = 'Select…',
	disabled = false,
	invalid = false,
	name,
	id,
}: SelectProps) {
	const [uncontrolled, setUncontrolled] = useState(defaultValue);
	const current = value !== undefined ? value : uncontrolled;
	const [open, setOpen] = useState(false);

	const wrapRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	// Deps include `open`: the popup only mounts while open, so the ref is
	// still null on `Select`'s own first render.
	const { ref: listRef } = useOverlayScrollbars<HTMLUListElement>([open]);
	const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

	const reactId = useId();
	const listId = id ?? `select-${reactId}`;

	const selectedIndex = options.findIndex((option) => option.value === current);
	const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
	const openUp = usePopupFlip(open, wrapRef);
	const position = useFloatingPosition(open, wrapRef, openUp);

	useOutsideClick(open, [wrapRef], () => setOpen(false));
	useNativePopover(open, listRef, () => {});
	useScrollLock(open, wrapRef);

	const commit = (index: number) => {
		const option = options[index];
		if (!option || option.disabled) return;
		if (value === undefined) setUncontrolled(option.value);
		onChange?.(option.value);
	};

	const close = (refocus: boolean) => {
		setOpen(false);
		if (refocus) triggerRef.current?.focus();
	};

	useCloseOnBlur(open, wrapRef, () => close(false));

	const focusIndex = (index: number) => {
		optionRefs.current[index]?.focus();
	};

	const openAt = (index: number) => {
		setOpen(true);
		requestAnimationFrame(() => {
			const start = index >= 0 ? index : firstEnabledIndex(options);
			if (start >= 0) focusIndex(start);
		});
	};

	const onTypeahead = useTypeahead((buffer) => {
		const focused = optionRefs.current.findIndex((el) => el === document.activeElement);
		const match = matchTypeahead(options, buffer, focused);
		if (match >= 0) focusIndex(match);
	});

	const onTriggerKeyDown = (event: KeyboardEvent) => {
		if (disabled) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openAt(selectedIndex);
		}
	};

	const onListKeyDown = (event: KeyboardEvent) => {
		const focused = optionRefs.current.findIndex((el) => el === document.activeElement);
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusIndex(nextEnabledIndex(options, focused, 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			focusIndex(nextEnabledIndex(options, focused, -1));
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusIndex(firstEnabledIndex(options));
		} else if (event.key === 'End') {
			event.preventDefault();
			focusIndex(lastEnabledIndex(options));
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			commit(focused);
			close(true);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close(true);
		} else {
			const char = printableChar(event);
			if (char) onTypeahead(char);
		}
	};

	return (
		<div class="select" ref={wrapRef}>
			<button
				type="button"
				ref={triggerRef}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				aria-invalid={invalid || undefined}
				onClick={() => (open ? close(true) : openAt(selectedIndex))}
				onKeyDown={onTriggerKeyDown}
			>
				<span class={selected ? undefined : 'muted'}>{selected ? selected.label : placeholder}</span>
				<ArrowDownIcon class="select-caret" />
			</button>
			{name && <input type="hidden" name={name} value={current ?? ''} />}
			{open && (
				<ul
					id={listId}
					class={openUp ? 'select-popup up' : 'select-popup'}
					role="listbox"
					ref={listRef}
					popover="manual"
					style={
						position
							? { position: 'fixed', top: `${position.top}px`, left: `${position.left}px`, width: `${position.width}px` }
							: undefined
					}
					tabIndex={-1}
					onKeyDown={onListKeyDown}
				>
					{options.map((option, index) => (
						<li
							key={option.value}
							ref={(el) => {
								optionRefs.current[index] = el;
							}}
							role="option"
							tabIndex={-1}
							aria-selected={option.value === current}
							aria-disabled={option.disabled || undefined}
							onClick={() => {
								if (option.disabled) return;
								commit(index);
								close(true);
							}}
						>
							<span>{option.label}</span>
							{option.value === current && <CheckIcon />}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
