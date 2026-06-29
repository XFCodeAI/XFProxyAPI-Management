import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';
import type { StatusBarData, StatusBlockDetail } from '@/utils/recentRequests';

const defaultStyles: Record<string, string> = {};

function rateToColor(rate: number): string {
  const t = Math.max(0, Math.min(1, rate));
  const destructiveWeight = Math.round((1 - t) * 100);
  return `color-mix(in srgb, var(--destructive) ${destructiveWeight}%, var(--primary))`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatSuccessRate(rate: number): string {
  const rounded = rate.toFixed(1);
  return `${rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded}%`;
}

type StylesModule = Record<string, string>;

interface ProviderStatusBarProps {
  statusData: StatusBarData;
  styles?: StylesModule;
}

export function ProviderStatusBar({ statusData, styles: stylesProp }: ProviderStatusBarProps) {
  const { t } = useTranslation();
  const s = (stylesProp || defaultStyles) as StylesModule;
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const blocksRef = useRef<HTMLDivElement>(null);

  const hasData = statusData.totalSuccess + statusData.totalFailure > 0;
  const rateClass = !hasData
    ? ''
    : statusData.successRate >= 90
      ? s.statusRateHigh
      : statusData.successRate >= 50
        ? s.statusRateMedium
        : s.statusRateLow;

  useEffect(() => {
    if (activeTooltip === null) return;
    const handler = (e: PointerEvent) => {
      if (blocksRef.current && !blocksRef.current.contains(e.target as Node)) {
        setActiveTooltip(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [activeTooltip]);

  const handlePointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    if (e.pointerType === 'touch') {
      e.preventDefault();
      setActiveTooltip((prev) => (prev === idx ? null : idx));
    }
  }, []);

  const renderTooltip = (detail: StatusBlockDetail) => {
    const total = detail.success + detail.failure;
    const timeRange = `${formatTime(detail.startTime)} – ${formatTime(detail.endTime)}`;

    return (
      <TooltipContent className="whitespace-nowrap px-2.5 py-2 text-[11px] leading-normal">
        <span className={s.tooltipTime}>{timeRange}</span>
        {total > 0 ? (
          <span className={s.tooltipStats}>
            <span className={s.tooltipSuccess}>
              {t('status_bar.success_short')} {detail.success}
            </span>
            <span className={s.tooltipFailure}>
              {t('status_bar.failure_short')} {detail.failure}
            </span>
            <span className={s.tooltipRate}>({(detail.rate * 100).toFixed(1)}%)</span>
          </span>
        ) : (
          <span className={s.tooltipStats}>{t('status_bar.no_requests')}</span>
        )}
      </TooltipContent>
    );
  };

  return (
    <div className={s.statusBar}>
      <div className={s.statusBlocks} ref={blocksRef}>
        {statusData.blockDetails.map((detail, idx) => {
          const isIdle = detail.rate === -1;
          const blockStyle = isIdle ? undefined : { backgroundColor: rateToColor(detail.rate) };
          const isActive = activeTooltip === idx;

          return (
            <Tooltip
              key={idx}
              open={isActive}
              onOpenChange={(open) => setActiveTooltip(open ? idx : null)}
            >
              <TooltipTrigger asChild>
                <div
                  className={`${s.statusBlockWrapper} ${isActive ? s.statusBlockActive : ''}`}
                  onPointerDown={(e) => handlePointerDown(e, idx)}
                >
                  <div
                    className={`${s.statusBlock} ${isIdle ? s.statusBlockIdle : ''}`}
                    style={blockStyle}
                  />
                </div>
              </TooltipTrigger>
              {renderTooltip(detail)}
            </Tooltip>
          );
        })}
      </div>
      <span className={`${s.statusRate} ${rateClass}`}>
        {hasData ? formatSuccessRate(statusData.successRate) : '--'}
      </span>
    </div>
  );
}
