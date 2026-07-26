import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { ArrowDownIcon, CheckIcon, XIcon } from './icons.js';
import {
	filterOptions,
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
	useCloseOnBlur,
	useOutsideClick,
	usePopupFlip,
	type ListOption,
} from './list-nav.js';

export type MultiSelectOption = ListOption;

export interface MultiSelectProps {
	options: MultiSelectOption[];
	value?: string[];
	defaultValue?: string[];
	onChange?: (value: string[]) => void;
	placeholder?: string;
	disabled?: boolean;
	invalid?: boolean;
	name?: string;
	id?: string;
	noResultsLabel?: string;
}

/**
 * Filterable multi select: a Combobox whose picks collect as chips instead
 * of replacing the input text, and whose popup stays open across picks so
 * several options can be toggled in one interaction.
 */
export default function MultiSelect({
	options,
	value,
	defaultValue = [],
	onChange,
	placeholder = 'Select…',
	disabled = false,
	invalid = false,
	name,
	id,
	noResultsLabel = 'No results.',
}: MultiSelectProps) {
	const [uncontrolled, setUncontrolled] = useState(defaultValue);
	const current = value ?? uncontrolled;

	const [text, setText] = useState('');
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);

	const wrapRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const reactId = useId();
	const listId = id ?? `multiselect-${reactId}`;
	const optionId = (index: number) => `${listId}-option-${index}`;

	const filtered = useMemo(() => filterOptions(options, open ? text : ''), [options, open, text]);
	const openUp = usePopupFlip(open, wrapRef);

	const setValue = (next: string[]) => {
		if (value === undefined) setUncontrolled(next);
		onChange?.(next);
	};

	const toggle = (option: MultiSelectOption) => {
		if (option.disabled) return;
		const set = new Set(current);
		if (set.has(option.value)) set.delete(option.value);
		else set.add(option.value);
		setValue(options.filter((o) => set.has(o.value)).map((o) => o.value));
		setText('');
		inputRef.current?.focus();
	};

	const removeChip = (val: string) => {
		setValue(current.filter((v) => v !== val));
		inputRef.current?.focus();
	};

	const openAt = (index: number) => {
		setOpen(true);
		setActiveIndex(index);
	};

	const close = () => {
		setOpen(false);
		setText('');
	};

	useOutsideClick(open, [wrapRef], close);
	useCloseOnBlur(open, wrapRef, close);

	const onKeyDown = (event: KeyboardEvent) => {
		if (disabled) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!open) openAt(firstEnabledIndex(filterOptions(options, text)));
			else setActiveIndex((i) => nextEnabledIndex(filtered, i, 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) openAt(lastEnabledIndex(filterOptions(options, text)));
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
				if (option) toggle(option);
			}
		} else if (event.key === 'Escape') {
			if (open) {
				event.preventDefault();
				close();
			}
		} else if (event.key === 'Backspace' && text === '' && current.length > 0) {
			removeChip(current[current.length - 1] as string);
		}
	};

	// Keep the highlighted row valid as the filtered list changes underneath it.
	useEffect(() => {
		if (!open) return;
		if (activeIndex >= filtered.length) setActiveIndex(firstEnabledIndex(filtered));
	}, [filtered, open]);

	return (
		<div class="select" ref={wrapRef}>
			{current.map((val) => {
				const option = options.find((o) => o.value === val);
				const label = option?.label ?? val;
				return (
					<span class="chip" key={val}>
						{label}
						<button type="button" aria-label={`Remove ${label}`} disabled={disabled} onClick={() => removeChip(val)}>
							<XIcon />
						</button>
					</span>
				);
			})}
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
				placeholder={current.length === 0 ? placeholder : undefined}
				value={text}
				onFocus={() => openAt(firstEnabledIndex(filterOptions(options, text)))}
				onInput={(event) => {
					const next = (event.currentTarget as HTMLInputElement).value;
					setText(next);
					setOpen(true);
					setActiveIndex(firstEnabledIndex(filterOptions(options, next)));
				}}
				onKeyDown={onKeyDown}
			/>
			<button
				type="button"
				class="select-trailing"
				disabled={disabled}
				aria-label="Toggle options"
				onClick={() => (open ? close() : openAt(firstEnabledIndex(filtered)))}
			>
				<ArrowDownIcon class="select-caret" />
			</button>
			{name && current.map((val) => <input key={val} type="hidden" name={name} value={val} />)}
			{open && (
				<ul
					id={listId}
					class={openUp ? 'select-popup up' : 'select-popup'}
					role="listbox"
					aria-multiselectable="true"
				>
					{filtered.length === 0 ? (
						<li class="muted" role="presentation">
							{noResultsLabel}
						</li>
					) : (
						filtered.map((option, index) => {
							const checked = current.includes(option.value);
							return (
								<li
									key={option.value}
									id={optionId(index)}
									role="option"
									class={index === activeIndex ? 'active' : undefined}
									aria-selected={checked}
									aria-disabled={option.disabled || undefined}
									onClick={() => toggle(option)}
								>
									<span>{option.label}</span>
									{checked && <CheckIcon />}
								</li>
							);
						})
					)}
				</ul>
			)}
		</div>
	);
}
