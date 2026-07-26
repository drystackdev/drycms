import dayjs, { type Dayjs } from "dayjs";
import { useId, useRef, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon } from "./icons.js";
import { useOutsideClick, usePopupFlip } from "./list-nav.js";
import NumberField from "./NumberField.js";

export type DatePickerMode = "calendar" | "select" | "input";

export interface DatePickerFieldProps extends FieldProps<Date> {
  /**
   * "calendar" - month grid. "select" - three day/month/year dropdowns.
   * "input" - the browser's native `<input type="date">` (or
   * "datetime-local" when `time` is set), with its own built-in picker UI.
   * @default "calendar"
   */
  mode?: DatePickerMode;
  /**
   * Whether the field also captures a time-of-day, not just a date. Adds an
   * Hour/Minute NumberField pair to "calendar"/"select", and switches
   * "input" to `type="datetime-local"`. @default false
   */
  time?: boolean;
  /** Only enforced in "calendar" mode, where out-of-range days are disabled. */
  min?: Date;
  max?: Date;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}

const WEEKDAYS = Array.from({ length: 7 }, (_, day) => dayjs().day(day).format("dd"));
const MONTHS = Array.from({ length: 12 }, (_, month) => dayjs().month(month).format("MMMM"));

function buildCalendarGrid(viewMonth: Dayjs): Dayjs[] {
  const start = viewMonth.startOf("month").subtract(viewMonth.startOf("month").day(), "day");
  return Array.from({ length: 42 }, (_, index) => start.add(index, "day"));
}

function isOutOfRange(day: Dayjs, min?: Date, max?: Date): boolean {
  if (min && day.isBefore(dayjs(min), "day")) return true;
  if (max && day.isAfter(dayjs(max), "day")) return true;
  return false;
}

export default function DatePickerField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  mode = "calendar",
  time = false,
  min,
  max,
  placeholder,
  disabled = false,
  name,
  id,
}: DatePickerFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `datepicker-field-${reactId}`;

  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => dayjs(value).startOf("month"));
  const wrapRef = useRef<HTMLDivElement>(null);
  const openUp = usePopupFlip(open, wrapRef);
  useOutsideClick(open, [wrapRef], () => setOpen(false));

  const format = time ? "DD/MM/YYYY HH:mm" : "DD/MM/YYYY";

  if (mode === "input") {
    const nativeType = time ? "datetime-local" : "date";
    const nativeFormat = time ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD";
    return (
      <div class="field">
        <label for={fieldId}>{label}</label>
        <input
          id={fieldId}
          type={nativeType}
          name={name}
          value={dayjs(value).format(nativeFormat)}
          min={min ? dayjs(min).format(nativeFormat) : undefined}
          max={max ? dayjs(max).format(nativeFormat) : undefined}
          disabled={disabled}
          aria-invalid={error || undefined}
          onInput={(event) => {
            const raw = (event.target as HTMLInputElement).value;
            if (!raw) return;
            const parsed = dayjs(raw);
            if (parsed.isValid()) onChange(parsed.toDate());
          }}
        />
        {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
      </div>
    );
  }

  const openPopup = () => {
    setViewMonth(dayjs(value).startOf("month"));
    setOpen(true);
  };

  const displayText = dayjs(value).format(format);

  const timeControls = time && (
    <div class="datepicker-time">
      <NumberField
        label="Hour"
        value={value.getHours()}
        onChange={(hour) => onChange(dayjs(value).hour(hour).toDate())}
        min={0}
        max={23}
      />
      <NumberField
        label="Minute"
        value={value.getMinutes()}
        onChange={(minute) => onChange(dayjs(value).minute(minute).toDate())}
        min={0}
        max={59}
      />
    </div>
  );

  return (
    <div class="field">
      <label for={fieldId}>{label}</label>
      <div class="select datepicker-trigger" ref={wrapRef}>
        <button
          id={fieldId}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={error || undefined}
          onClick={() => (open ? setOpen(false) : openPopup())}
        >
          <span>{displayText || placeholder}</span>
          <CalendarIcon class="select-icon" />
        </button>
        {name && (
          <input type="hidden" name={name} value={dayjs(value).toISOString()} />
        )}
        {open && mode === "calendar" && (
          <div class={openUp ? "datepicker-popup up" : "datepicker-popup"}>
            <div class="datepicker-nav">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setViewMonth((current) => current.subtract(1, "month"))}
              >
                <ArrowLeftIcon />
              </button>
              <span>{viewMonth.format("MMMM YYYY")}</span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setViewMonth((current) => current.add(1, "month"))}
              >
                <ArrowRightIcon />
              </button>
            </div>
            <div class="datepicker-grid">
              {WEEKDAYS.map((weekday) => (
                <span key={weekday} class="datepicker-weekday">
                  {weekday}
                </span>
              ))}
              {buildCalendarGrid(viewMonth).map((day) => (
                <button
                  key={day.format("YYYY-MM-DD")}
                  type="button"
                  class={day.month() === viewMonth.month() ? undefined : "outside"}
                  aria-selected={day.isSame(value, "day")}
                  aria-current={day.isSame(dayjs(), "day") ? "date" : undefined}
                  disabled={isOutOfRange(day, min, max)}
                  onClick={() =>
                    onChange(
                      dayjs(value).year(day.year()).month(day.month()).date(day.date()).toDate(),
                    )
                  }
                >
                  {day.date()}
                </button>
              ))}
            </div>
            {timeControls}
          </div>
        )}
        {open && mode === "select" && (
          <div class={openUp ? "datepicker-popup up" : "datepicker-popup"}>
            <div class="datepicker-select-row">
              <select
                aria-label="Day"
                value={value.getDate()}
                onChange={(event) =>
                  onChange(
                    dayjs(value)
                      .date(Number((event.target as HTMLSelectElement).value))
                      .toDate(),
                  )
                }
              >
                {Array.from(
                  { length: dayjs(value).daysInMonth() },
                  (_, index) => index + 1,
                ).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
              <select
                aria-label="Month"
                value={value.getMonth()}
                onChange={(event) =>
                  onChange(
                    dayjs(value)
                      .month(Number((event.target as HTMLSelectElement).value))
                      .toDate(),
                  )
                }
              >
                {MONTHS.map((monthName, index) => (
                  <option key={monthName} value={index}>
                    {monthName}
                  </option>
                ))}
              </select>
              <select
                aria-label="Year"
                value={value.getFullYear()}
                onChange={(event) =>
                  onChange(
                    dayjs(value)
                      .year(Number((event.target as HTMLSelectElement).value))
                      .toDate(),
                  )
                }
              >
                {Array.from(
                  { length: 111 },
                  (_, index) => dayjs().year() - 100 + index,
                ).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            {timeControls}
          </div>
        )}
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
