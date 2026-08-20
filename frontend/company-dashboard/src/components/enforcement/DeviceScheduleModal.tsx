"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { X, Loader2, Save, Trash2, Info } from "lucide-react";
import { toast } from "sonner";
import { companyApi, deviceApi } from "@/lib/api";
import { ScheduleEditor, EnforcementBadge, defaultSchedule, type ScheduleValue } from "./ScheduleEditor";

/**
 * Working hours for one device.
 *
 * Most devices should not need this — a company sets one org-wide schedule and
 * every personal laptop inherits it. The override exists for the contractor on
 * a different shift, and for the machine that genuinely does need to be watched
 * around the clock while everything else follows the working day.
 */
export function DeviceScheduleModal({
  device,
  onClose,
  onSaved,
}: {
  device: { id: string; hostname?: string; ownership?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ScheduleValue | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["device-enforcement", device.id],
    queryFn: () => deviceApi.enforcement(device.id),
  });
  const { data: tzData } = useQuery({
    queryKey: ["timezones"],
    queryFn: () => companyApi.timezones(),
  });

  const state = data?.data?.state;
  const hasOverride: boolean = !!data?.data?.has_override;
  const override = data?.data?.override;
  const inherited = data?.data?.inherited;
  const timezones: string[] = tzData?.data?.timezones ?? tzData?.data ?? [];

  useEffect(() => {
    if (draft !== null || isLoading) return;
    const source = hasOverride ? override : inherited;
    setDraft(
      source
        ? {
            timezone: source.timezone,
            windows: source.windows ?? [],
            holidays: source.holidays ?? [],
            off_hours_mode: source.off_hours_mode ?? "full_pause",
            enabled: true,
          }
        : defaultSchedule(timezones[0] ?? "UTC")
    );
  }, [draft, isLoading, hasOverride, override, inherited, timezones]);

  const saveMut = useMutation({
    mutationFn: (value: ScheduleValue) => deviceApi.putSchedule(device.id, value),
    onSuccess: () => { toast.success("Device working hours saved"); onSaved(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not save the schedule"),
  });

  const clearMut = useMutation({
    mutationFn: () => deviceApi.deleteSchedule(device.id),
    onSuccess: () => { toast.success("Override removed — this device follows the inherited schedule"); onSaved(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not remove the override"),
  });

  const inheritedLabel = inherited
    ? inherited.scope === "org" ? "the organization schedule" : "its team's schedule"
    : "no schedule — enforcing 24×7";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Working hours — {device.hostname || "device"}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {hasOverride
                ? "This device has its own schedule."
                : `Currently following ${inheritedLabel}.`}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {state && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2 my-4">
            <EnforcementBadge state={state} />
            <span className="text-sm text-muted-foreground">{state.reason}</span>
          </div>
        )}

        {device.ownership === "personal" && !hasOverride && !inherited && (
          <div className="flex gap-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 mb-4">
            <Info className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
            <p className="text-sm text-body">
              This is a personal device with no schedule, so the agent is intercepting it around the
              clock — including outside working hours.
            </p>
          </div>
        )}

        {isLoading || !draft ? (
          <div className="flex justify-center py-14">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScheduleEditor value={draft} onChange={setDraft} timezones={timezones} />
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <div>
            {hasOverride && (
              <button
                onClick={() => clearMut.mutate()}
                disabled={clearMut.isPending}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-danger"
              >
                <Trash2 className="w-4 h-4" /> Remove override
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-3.5 py-2 text-sm text-body hover:bg-elevated">
              Cancel
            </button>
            <button
              onClick={() => draft && saveMut.mutate(draft)}
              disabled={!draft || draft.windows.length === 0 || saveMut.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-600 disabled:opacity-60"
            >
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save for this device
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
