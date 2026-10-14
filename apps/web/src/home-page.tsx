import { Button, TextField } from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Edit02Icon } from "@hugeicons/core-free-icons";

export function HomePage({
  name,
  text,
  onChange,
  canEdit,
  onContinue,
}: {
  name: string;
  text: string;
  onChange: (text: string) => void;
  canEdit: boolean;
  onContinue: () => void;
}) {
  return (
    <section className="mx-auto flex min-h-[70dvh] w-full max-w-3xl flex-col justify-center py-10 sm:py-16">
      <p className="mb-4 text-sm font-medium text-accent">Hi {name}</p>
      <h1 className="max-w-2xl text-3xl font-medium tracking-tight sm:text-4xl">
        Dump thoughts off your head
      </h1>
      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() && canEdit) onContinue();
        }}
      >
        <TextField
          label="Post text"
          hideLabel
          multiline
          value={text}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Start with an idea…"
          maxLength={3000}
          disabled={!canEdit}
          variant="primary"
          className="min-h-52 resize-y p-5 text-base leading-relaxed"
        />
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            onPress={onContinue}
            isDisabled={!canEdit}
          >
            <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden />
            Open Editor
          </Button>
          <Button type="submit" isDisabled={!canEdit || !text.trim()}>
            Continue
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden />
          </Button>
        </div>
      </form>
      {!canEdit && (
        <p className="mt-4 text-sm text-muted">
          Ask an administrator for write access to create posts.
        </p>
      )}
    </section>
  );
}
