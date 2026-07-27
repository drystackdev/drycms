import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { ArrowDownIcon, XIcon } from './icons.js';
import {
	filterOptions,
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
	useCloseOnBlur,
	useFloatingPosition,
	useNativePopover,
	useOutsideClick,
	usePopupFlip,
	useScrollLock,
	type ListOption,
} from './list-nav.js';
import { useOverlayScrollbars } from './overlayscrollbars.js';

export type ComboboxOption = ListOption;

export interface ComboboxProps {
	options: ComboboxOption[];
	value?: string;
	defaultValue?: string;
	onChange?: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	invalid?: boolean;
	name?: string;
	id?: string;
	noResultsLabel?: string;
}

/**
 * Filterable single select. Follows the ARIA APG "combobox with list"
 * pattern: focus stays on the text input, and `aria-activedescendant` tracks
 * the highlighted option instead of real DOM focus (see Select, which can
 * move focus into the popup because it has no text input to keep it in).
 */
export default function Combobox({
	options,
	value,
	defaultValue,
	onChange,
	placeholder = 'Search…',
	disabled = false,
	invalid = false,
	name,
	id,
	noResultsLabel = 'No results.',
}: ComboboxProps) {
	const [uncontrolled, setUncontrolled] = useState(defaultValue);
	const current = value !== undefined ? value : uncontrolled;
	const labelFor = (val: string | undefined) => options.find((option) => option.value === val)?.label ?? '';

	const [text, setText] = useState(() => labelFor(current));
	// Separate from `text`: `text` is the input's resting display value (the
	// selected option's label, kept even while closed), `query` is what
	// actually filters the list. Opening via focus/click/arrow-key (not
	// typing) resets `query` to '' - otherwise the popup would open already
	// filtered down to just the currently-selected option, since `text` still
	// holds its label at that point.
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);

	const wrapRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	// Deps include `open`: the popup only mounts while open, so the ref is
	// still null on `Combobox`'s own first render.
	const { ref: listRef } = useOverlayScrollbars<HTMLUListElement>([open]);

	const reactId = useId();
	const listId = id ?? `combobox-${reactId}`;
	const optionId = (index: number) => `${listId}-option-${index}`;

	const filtered = useMemo(() => filterOptions(options, open ? query : ''), [options, open, query]);
	const openUp = usePopupFlip(open, wrapRef);
	const position = useFloatingPosition(open, wrapRef, openUp);

	// Controlled value changed elsewhere while the popup was closed - resync
	// the display text. Also resyncs when `options` itself changes, so a
	// `value` set before an async options list finishes loading still
	// resolves to its label once the matching option shows up.
	useEffect(() => {
		if (value === undefined || open) return;
		setText(labelFor(value));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value, open, options]);

	const commit = (option: ComboboxOption) => {
		if (option.disabled) return;
		if (value === undefined) setUncontrolled(option.value);
		onChange?.(option.value);
		setText(option.label);
		setOpen(false);
		inputRef.current?.focus();
	};

	const clear = () => {
		if (value === undefined) setUncontrolled(undefined);
		onChange?.('');
		setText('');
		setOpen(false);
		inputRef.current?.focus();
	};

	const revert = () => {
		setText(labelFor(current));
		setOpen(false);
	};

	useOutsideClick(open, [wrapRef], revert);
	useCloseOnBlur(open, wrapRef, revert);
	useNativePopover(open, listRef, () => {});
	useScrollLock(open, wrapRef);

	// Opens without filtering - see `query`'s comment above.
	const openAt = (index: number) => {
		setOpen(true);
		setQuery('');
		setActiveIndex(index);
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (disabled) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!open) openAt(firstEnabledIndex(options));
			else setActiveIndex((i) => nextEnabledIndex(filtered, i, 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) openAt(lastEnabledIndex(options));
			else setActiveIndex((i) => nextEnabledIndex(filtered, i, -1));
		} else if (event.key === 'Home' && open) {
			event.preventDefault();
			setActiveIndex(firstEnabledIndex(filtered));
		} else if (event.key === 'End' && open) {
			event.preventDefault();
			setActiveIndex(lastEnabledIndex(filtered));
		} else if (event.key === 'Enter') {
			if (open && activeIndex >= 0) {
				event.preventDefault();
				const option = filtered[activeIndex];
				if (option) commit(option);
			}
		} else if (event.key === 'Escape') {
			if (open) {
				event.preventDefault();
				revert();
			}
		}
	};

	return (
		<div class="select" ref={wrapRef}>
			<input
				type="text"
				ref={inputRef}
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={open}
				aria-controls={listId}
				aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
				aria-invalid={invalid || undefined}
				autoComplete="off"
				disabled={disabled}
				placeholder={placeholder}
				value={text}
				onFocus={(event) => {
					event.currentTarget.select();
					openAt(firstEnabledIndex(options));
				}}
				onClick={(event) => {
					if (open) return;
					(event.currentTarget as HTMLInputElement).select();
					openAt(firstEnabledIndex(options));
				}}
				onInput={(event) => {
					const next = (event.currentTarget as HTMLInputElement).value;
					setText(next);
					setQuery(next);
					setOpen(true);
					setActiveIndex(firstEnabledIndex(filterOptions(options, next)));
				}}
				onKeyDown={onKeyDown}
			/>
			<button
				type="button"
				class="select-trailing"
				disabled={disabled}
				aria-label={current ? 'Clear' : 'Toggle options'}
				onClick={() => (current ? clear() : open ? revert() : openAt(firstEnabledIndex(filtered)))}
			>
				{current ? <XIcon /> : <ArrowDownIcon class="select-caret" />}
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
				>
					{filtered.length === 0 ? (
						<li class="muted" role="presentation">
							{noResultsLabel}
						</li>
					) : (
						filtered.map((option, index) => (
							<li
								key={option.value}
								id={optionId(index)}
								role="option"
								class={index === activeIndex ? 'active' : undefined}
								aria-selected={option.value === current}
								aria-disabled={option.disabled || undefined}
								onClick={() => commit(option)}
							>
								<span>{option.label}</span>
							</li>
						))
					)}
				</ul>
			)}
		</div>
	);
}
