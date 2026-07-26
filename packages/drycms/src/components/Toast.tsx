import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import Icon from './Icon.js';
import type { IconName } from './icons.js';

export type ToastType = 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastActionProps {
	children: ComponentChildren;
	onClick?: () => void;
}

export interface ToastOptions {
	/** Omit to create a new toast; pass an existing id to update it in place. */
	id?: string;
	title?: ComponentChildren;
	description?: ComponentChildren;
	type?: ToastType;
	/** Auto-dismiss delay in ms. `0` disables auto-dismiss. Defaults to 5000 (0 for `type: "loading"`). */
	timeout?: number;
	/** `'high'` interrupts screen readers immediately; `'low'` (default) waits its turn. */
	priority?: 'low' | 'high';
	actionProps?: ToastActionProps;
	onClose?: () => void;
	onRemove?: () => void;
}

interface ToastItem {
	id: string;
	title?: ComponentChildren;
	description?: ComponentChildren;
	type: ToastType;
	timeout: number;
	priority: 'low' | 'high';
	actionProps?: ToastActionProps;
	onClose?: () => void;
	onRemove?: () => void;
	closing: boolean;
	swipeDirection?: 'down' | 'right';
}

const DEFAULT_TIMEOUT = 5000;
/** Kept just above the CSS closing transition (480ms, see `.toast` in
 * components.css) so the card never gets unmounted mid-animation. */
const EXIT_DURATION = 520;
const LIMIT = 4;

const TYPE_ICON: Partial<Record<ToastType, IconName>> = {
	success: 'CheckCircle',
	error: 'XCircle',
	warning: 'AlertTriangle',
	info: 'InfoCircle',
};

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, { handle: ReturnType<typeof setTimeout>; remaining: number; startedAt: number }>();
let nextId = 0;

function notify() {
	for (const listener of listeners) listener();
}

function clearTimer(id: string) {
	const timer = timers.get(id);
	if (!timer) return;
	clearTimeout(timer.handle);
	timers.delete(id);
}

function scheduleTimer(id: string, delay: number) {
	clearTimer(id);
	if (delay <= 0) return;
	timers.set(id, {
		handle: setTimeout(() => close(id), delay),
		remaining: delay,
		startedAt: Date.now(),
	});
}

/** Pauses every running timer - used while the viewport is hovered/focused. */
function pauseTimers() {
	for (const timer of timers.values()) {
		clearTimeout(timer.handle);
		timer.remaining -= Date.now() - timer.startedAt;
	}
}

function resumeTimers() {
	for (const [id, timer] of timers) {
		timer.startedAt = Date.now();
		timer.handle = setTimeout(() => close(id), Math.max(timer.remaining, 0));
	}
}

function add(options: ToastOptions): string {
	const id = options.id ?? `toast-${++nextId}`;
	const type = options.type ?? 'default';
	const timeout = options.timeout ?? (type === 'loading' ? 0 : DEFAULT_TIMEOUT);
	const item: ToastItem = {
		id,
		title: options.title,
		description: options.description,
		type,
		timeout,
		priority: options.priority ?? 'low',
		actionProps: options.actionProps,
		onClose: options.onClose,
		onRemove: options.onRemove,
		closing: false,
	};

	const existingIndex = items.findIndex((entry) => entry.id === id);
	if (existingIndex >= 0) {
		items = items.map((entry, index) => (index === existingIndex ? item : entry));
	} else {
		items = [...items, item];
		if (items.length > LIMIT) {
			const [evicted, ...rest] = items;
			items = rest;
			if (evicted) {
				clearTimer(evicted.id);
				evicted.onRemove?.();
			}
		}
	}
	notify();
	scheduleTimer(id, timeout);
	return id;
}

/** Merges options into an existing toast (a no-op if it already closed). */
function update(id: string, options: Omit<ToastOptions, 'id'>) {
	if (!items.some((entry) => entry.id === id)) return;
	add({ ...options, id });
}

function close(id?: string, swipeDirection?: ToastItem['swipeDirection']) {
	const targets = id ? items.filter((entry) => entry.id === id) : items;
	const targetIds = new Set(targets.map((entry) => entry.id));
	for (const target of targets) {
		if (target.closing) continue;
		clearTimer(target.id);
		target.onClose?.();
	}
	items = items.map((entry) => (targetIds.has(entry.id) ? { ...entry, closing: true, swipeDirection } : entry));
	notify();
	for (const target of targets) {
		setTimeout(() => {
			items = items.filter((entry) => entry.id !== target.id);
			notify();
			target.onRemove?.();
		}, EXIT_DURATION);
	}
}

interface PromiseMessages<T> {
	loading?: ComponentChildren;
	success?: ComponentChildren | ((value: T) => ComponentChildren);
	error?: ComponentChildren | ((error: unknown) => ComponentChildren);
}

function promise<T>(value: Promise<T>, messages: PromiseMessages<T>): Promise<T> {
	const id = add({ title: messages.loading ?? 'Loading…', type: 'loading' });
	return value.then(
		(resolved) => {
			update(id, {
				title: typeof messages.success === 'function' ? messages.success(resolved) : messages.success,
				type: 'success',
			});
			return resolved;
		},
		(error: unknown) => {
			update(id, {
				title: typeof messages.error === 'function' ? messages.error(error) : messages.error,
				type: 'error',
			});
			throw error;
		},
	);
}

/** Imperative API - call from anywhere, no provider/context needed. */
export const toast = { add, update, close, promise };

function useToastItems(): ToastItem[] {
	const [, setTick] = useState(0);
	useEffect(() => {
		const listener = () => setTick((tick) => tick + 1);
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}, []);
	return items;
}

const SWIPE_THRESHOLD = 80;
/** Peek offset (px) per layer while collapsed - just enough to read as a stack. */
const COLLAPSED_PEEK = 14;
/** Gap (px) between cards once the stack fans out (hover/focus). */
const EXPANDED_GAP = 10;
/** Assumed card height (px) before the real one is measured on first paint. */
const FALLBACK_HEIGHT = 64;

interface ToastCardProps {
	item: ToastItem;
	index: number;
	offsetY: number;
	expanded: boolean;
	onResize: (id: string, height: number) => void;
}

function ToastCard({ item, index, offsetY, expanded, onResize }: ToastCardProps) {
	const ref = useRef<HTMLDivElement>(null);
	const drag = useRef<{ startX: number; startY: number } | null>(null);
	const [swipe, setSwipe] = useState({ x: 0, y: 0, active: false });
	// Starts detached from the "open" transition so the browser has a real
	// before/after to animate between on the very next frame, instead of
	// racing a `transition` against a mount-time `animation` on one property.
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		const raf = requestAnimationFrame(() => setMounted(true));
		return () => cancelAnimationFrame(raf);
	}, []);

	useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(([entry]) => {
			const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height;
			if (height) onResize(item.id, height);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [item.id, onResize]);

	const onPointerDown = (event: PointerEvent) => {
		if ((event.target as HTMLElement).closest('[data-toast-no-swipe]')) return;
		drag.current = { startX: event.clientX, startY: event.clientY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (!drag.current) return;
		setSwipe({
			x: Math.max(0, event.clientX - drag.current.startX),
			y: Math.max(0, event.clientY - drag.current.startY),
			active: true,
		});
	};

	const endDrag = () => {
		if (!drag.current) return;
		drag.current = null;
		setSwipe((current) => {
			if (current.x > SWIPE_THRESHOLD || current.y > SWIPE_THRESHOLD) {
				close(item.id, current.x > current.y ? 'right' : 'down');
				return current;
			}
			return { x: 0, y: 0, active: false };
		});
	};

	const typeIcon = TYPE_ICON[item.type];
	// 'open' is the CSS rest state (no rule needed for it) - only 'starting'/
	// 'closing' carry one, so only those two ever appear as a class.
	const state = item.closing ? 'closing' : !mounted ? 'starting' : undefined;

	const cardClass = [
		'toast',
		item.type,
		state,
		expanded && 'expanded',
		index > 0 && 'behind',
		swipe.active && 'swiping',
		item.swipeDirection === 'down' && 'swipe-down',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div
			ref={ref}
			class={cardClass}
			role={item.priority === 'high' ? 'alert' : 'status'}
			aria-live={item.priority === 'high' ? 'assertive' : 'polite'}
			style={{
				'--toast-index': index,
				'--toast-offset-y': `${offsetY}px`,
				'--toast-swipe-movement-x': `${swipe.x}px`,
				'--toast-swipe-movement-y': `${swipe.y}px`,
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
		>
			<div class="toast-body">
				{item.type === 'loading' ? (
					<span class="toast-spinner" aria-hidden="true" />
				) : typeIcon ? (
					<Icon name={typeIcon} />
				) : null}

				<div class="toast-content">
					{item.title ? <strong>{item.title}</strong> : null}
					{item.description ? <p>{item.description}</p> : null}
				</div>

				<div class="toast-actions">
					{item.actionProps ? (
						<button
							type="button"
							class="ghost sm toast-action"
							data-toast-no-swipe
							onClick={() => {
								item.actionProps?.onClick?.();
								close(item.id);
							}}
						>
							{item.actionProps.children}
						</button>
					) : null}

					<button
						type="button"
						class="ghost icon sm toast-close"
						data-toast-no-swipe
						aria-label="Dismiss notification"
						onClick={() => close(item.id)}
					>
						<Icon name="Close" />
					</button>
				</div>
			</div>
		</div>
	);
}

export interface ToasterProps {
	/** Corner the stack anchors to. Defaults to `bottom-end`. */
	position?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
}

/**
 * Mount once (e.g. at the app root) - renders the toast stack. Trigger toasts
 * from anywhere with `toast.add(...)`, no provider wiring required.
 *
 * Rendered via the Popover API (`popover="manual"`) rather than a portal: it
 * puts the stack in the browser's top layer, so it floats above an open
 * native `<dialog>` too, without a manual z-index scale.
 *
 * Collapsed, the cards overlap into a shallow deck (a `ResizeObserver` per
 * card feeds real heights back up, since a CSS-only guess would misalign the
 * peek the moment a title wraps to two lines); hovering/focusing the
 * viewport fans them out to full height so every toast is readable.
 */
export default function Toaster({ position = 'bottom-end' }: ToasterProps) {
	const toasts = useToastItems();
	const viewportRef = useRef<HTMLDivElement>(null);
	const previousCount = useRef(0);
	const [heights, setHeights] = useState<Record<string, number>>({});
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		el.setAttribute('popover', 'manual');
		el.showPopover?.();
	}, []);

	// The top layer stacks by "last shown wins" - an open `<dialog>` shown
	// after the viewport's one `showPopover()` call would otherwise bury every
	// toast added from then on. Re-promoting on each new toast keeps the
	// stack above it without a portal or z-index scale.
	useEffect(() => {
		const el = viewportRef.current;
		if (el && toasts.length > previousCount.current && el.matches?.(':popover-open')) {
			el.hidePopover?.();
			el.showPopover?.();
		}
		previousCount.current = toasts.length;
	}, [toasts]);

	// Drop heights for toasts that have fully closed, so a long-lived session
	// doesn't accumulate stale entries under reused/incrementing ids.
	useEffect(() => {
		setHeights((current) => {
			const liveIds = new Set(toasts.map((entry) => entry.id));
			let changed = false;
			const next: Record<string, number> = {};
			for (const [id, height] of Object.entries(current)) {
				if (liveIds.has(id)) next[id] = height;
				else changed = true;
			}
			return changed ? next : current;
		});
	}, [toasts]);

	const handleResize = (id: string, height: number) => {
		setHeights((current) => (current[id] === height ? current : { ...current, [id]: height }));
	};

	const handleEnter = () => {
		setExpanded(true);
		pauseTimers();
	};
	const handleLeave = () => {
		setExpanded(false);
		resumeTimers();
	};

	// Render newest-first so array position lines up with `--toast-index`
	// (0 = frontmost); accumulate each card's real height to place the next
	// one behind it once expanded.
	const ordered = [...toasts].reverse();
	let cumulative = 0;
	const placed = ordered.map((item, index) => {
		const offsetY = expanded ? cumulative : index * COLLAPSED_PEEK;
		cumulative += (heights[item.id] ?? FALLBACK_HEIGHT) + EXPANDED_GAP;
		return { item, index, offsetY };
	});
	const frontmostHeight = heights[ordered[0]?.id ?? ''] ?? FALLBACK_HEIGHT;

	const viewportClass = [
		'toast-viewport',
		position.startsWith('top') && 'top',
		position.endsWith('start') && 'start',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div
			ref={viewportRef}
			class={viewportClass}
			role="region"
			aria-label="Notifications"
			// Reserves the full expanded extent (cards + gaps) as one continuous
			// hit-test box, even while collapsed - without it, the gaps between
			// cards belong to whatever's behind the stack, so crossing one on the
			// way to another toast fires a spurious pointerleave/enter and the
			// stack flickers collapsed/expanded under the cursor.
			style={{ '--toast-frontmost-height': `${frontmostHeight}px`, height: `${cumulative}px` }}
			onPointerEnter={handleEnter}
			onPointerLeave={handleLeave}
			onFocusIn={handleEnter}
			onFocusOut={handleLeave}
		>
			{placed.map(({ item, index, offsetY }) => (
				<ToastCard
					key={item.id}
					item={item}
					index={index}
					offsetY={offsetY}
					expanded={expanded}
					onResize={handleResize}
				/>
			))}
		</div>
	);
}
