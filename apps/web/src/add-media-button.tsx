import { Button, TooltipText } from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { AttachmentIcon } from "@hugeicons/core-free-icons";

export function AddMediaButton({
  storageEnabled,
  disabled,
  onPress,
}: {
  storageEnabled: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TooltipText
      tooltip={
        !storageEnabled ? "Media storage hasn't been configured." : undefined
      }
      openOnPress={!storageEnabled}
      tabIndex={storageEnabled ? undefined : 0}
      role={storageEnabled ? undefined : "group"}
      aria-label={storageEnabled ? undefined : "Why Add media is unavailable"}
      className="inline-flex w-fit rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <Button
        variant="secondary"
        onPress={onPress}
        isDisabled={disabled || !storageEnabled}
        className={!storageEnabled ? "pointer-events-none" : undefined}
      >
        <HugeiconsIcon icon={AttachmentIcon} size={16} aria-hidden />
        Add media
      </Button>
    </TooltipText>
  );
}
