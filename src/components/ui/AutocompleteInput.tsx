import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { IconChevronDown } from './icons';
import { cn } from '@/lib/utils';
import {
  fieldErrorClass,
  fieldHintClass,
  fieldLabelClass,
  fieldRootClass,
  inputClass,
} from './formStyles';
import styles from './AutocompleteInput.module.scss';

interface AutocompleteInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | { value: string; label?: string }[];
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  id?: string;
  rightElement?: ReactNode;
}

export function AutocompleteInput({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  hint,
  error,
  className = '',
  wrapperClassName = '',
  wrapperStyle,
  id,
  rightElement,
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const normalizedOptions = options.map((opt) =>
    typeof opt === 'string'
      ? { value: opt, label: opt }
      : { value: opt.value, label: opt.label || opt.value }
  );

  const filteredOptions = normalizedOptions.filter((opt) => {
    const query = value.toLowerCase();
    return (
      opt.value.toLowerCase().includes(query) ||
      (opt.label && opt.label.toLowerCase().includes(query))
    );
  });

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightedIndex((previous) =>
        previous < filteredOptions.length - 1 ? previous + 1 : previous
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((previous) => (previous > 0 ? previous - 1 : 0));
      return;
    }

    if (event.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        event.preventDefault();
        handleSelect(filteredOptions[highlightedIndex].value);
      } else if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
      return;
    }

    if (event.key === 'Escape' || event.key === 'Tab') {
      setIsOpen(false);
    }
  };

  return (
    <div
      className={cn(fieldRootClass, styles.root, wrapperClassName)}
      ref={containerRef}
      style={wrapperStyle}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
          setIsOpen(false);
        }
      }}
    >
      {label ? (
        <label htmlFor={id} className={fieldLabelClass}>
          {label}
        </label>
      ) : null}
      <div className={styles.inputShell}>
        <input
          id={id}
          className={cn(
            inputClass,
            styles.inputWithToggle,
            className
          )}
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-invalid={Boolean(error)}
        />
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onMouseDown={(event) => event.preventDefault()}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
        >
          {rightElement}
          <IconChevronDown size={16} />
        </button>

        {isOpen && filteredOptions.length > 0 && !disabled ? (
          <div className={styles.menu}>
            {filteredOptions.map((opt, index) => (
              <button
                key={`${opt.value}-${index}`}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={cn(
                  styles.option,
                  index === highlightedIndex ? styles.optionHighlighted : ''
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className={styles.optionValue}>{opt.value}</span>
                {opt.label && opt.label !== opt.value ? (
                  <span className={styles.optionLabel}>{opt.label}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {hint ? <div className={fieldHintClass}>{hint}</div> : null}
      {error ? (
        <div className={fieldErrorClass}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
