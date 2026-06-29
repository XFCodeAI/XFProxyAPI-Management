import { useCallback, useMemo, useRef, useState } from 'react';
import styles from './AuthFilesStatusFilterCard.module.scss';

export type AuthFilesStatusFilterOption = {
  value: string;
  label: string;
};

export type AuthFilesStatusFilterCardProps = {
  label: string;
  minLabel?: string;
  maxLabel?: string;
  value: string;
  options: AuthFilesStatusFilterOption[];
  onChange: (value: string) => void;
};

export function AuthFilesStatusFilterCard({
  label,
  minLabel,
  maxLabel,
  value,
  options,
  onChange,
}: AuthFilesStatusFilterCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const sliderValue = (activeIndex / Math.max(1, options.length - 1)) * 100;
  const isActive = activeIndex === options.length - 1;
  const isFull = sliderValue === 100;
  const currentOption = options[activeIndex] ?? options[0];

  const thumbStyle = useMemo(() => ({ left: `${sliderValue}%` }), [sliderValue]);

  const selectIndex = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(options.length - 1, nextIndex));
      const nextValue = options[clamped]?.value;
      if (nextValue && nextValue !== value) {
        onChange(nextValue);
      }
    },
    [onChange, options, value]
  );

  const selectFromPercent = useCallback(
    (raw: number) => {
      const step = 100 / Math.max(1, options.length - 1);
      const nextIndex = Math.max(
        0,
        Math.min(options.length - 1, Math.round(raw / step + 1e-9))
      );
      selectIndex(nextIndex);
    },
    [options.length, selectIndex]
  );

  const selectFromClientX = useCallback(
    (clientX: number) => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const raw = ((clientX - rect.left) / rect.width) * 100;
      selectFromPercent(Math.max(0, Math.min(100, raw)));
    },
    [selectFromPercent]
  );

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (options.length <= 1) return;
    event.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    inputRef.current?.focus({ preventScroll: true });
    selectFromClientX(event.clientX);
  };

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    selectFromClientX(event.clientX);
  };

  const handleTrackPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectFromPercent(Number(event.currentTarget.value));
  };

  const trackWrapperClass = [
    styles.trackWrapper,
    isActive ? styles.trackWrapperActive : '',
    isFull ? styles.trackWrapperFull : '',
    isDragging ? styles.trackWrapperDragging : '',
  ].join(' ');

  const statusClass = [
    styles.statusText,
    isActive ? styles.statusTextActive : '',
  ].join(' ');

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.labelText}>{label}</span>
          <span className={statusClass}>{currentOption.label}</span>
        </div>
      </div>

      <div className={styles.scaleLabels}>
        <span>{minLabel ?? options[0]?.label}</span>
        <span>{maxLabel ?? options[options.length - 1]?.label}</span>
      </div>

      <div
        className={trackWrapperClass}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerEnd}
        onPointerCancel={handleTrackPointerEnd}
      >
        <div className={styles.trackBg} />
        <div className={styles.dotsLayer}>
          {options.map((option, index) => {
            const stepCount = Math.max(1, options.length - 1);
            const left = `${(index / stepCount) * 100}%`;
            return <span key={option.value} className={styles.dot} style={{ left }} aria-hidden />;
          })}
        </div>
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={100}
          step="any"
          value={sliderValue}
          className={styles.slider}
          onChange={handleInput}
          aria-label={label}
          disabled={options.length <= 1}
        />
        <div className={styles.thumbLayer} aria-hidden="true">
          <span className={styles.thumb} style={thumbStyle} />
        </div>
      </div>
    </div>
  );
}
