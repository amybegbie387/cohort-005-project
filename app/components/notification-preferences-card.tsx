import { useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import type { NotificationSwitch } from "~/lib/notification-preferences.server";

export function NotificationPreferencesCard({
  switches,
}: {
  switches: NotificationSwitch[];
}) {
  return (
    <Card id="notifications" className="mt-8 max-w-md scroll-mt-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose what shows up in your Notification Feed. Changes save as you
          flip them.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {switches.map((notificationSwitch) => (
          <NotificationSwitchRow
            key={notificationSwitch.category}
            notificationSwitch={notificationSwitch}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function NotificationSwitchRow({
  notificationSwitch,
}: {
  notificationSwitch: NotificationSwitch;
}) {
  const { category, label } = notificationSwitch;
  const fetcher = useFetcher<{ saved: boolean }>();

  // Show the flip while it is saving; once settled, the saved value wins, so a
  // failed save reverts by itself.
  const enabled = fetcher.formData
    ? fetcher.formData.get("enabled") === "true"
    : notificationSwitch.enabled;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.saved === false) {
      toast.error(`Couldn't save "${label}". Please try again.`);
    }
  }, [fetcher.state, fetcher.data, label]);

  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={`notification-${category}`}>{label}</Label>
      <Switch
        id={`notification-${category}`}
        checked={enabled}
        onCheckedChange={(checked) =>
          fetcher.submit(
            { category, enabled: String(checked) },
            { method: "post", action: "/api/notification-preferences" }
          )
        }
      />
    </div>
  );
}
