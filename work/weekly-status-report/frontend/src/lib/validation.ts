export interface GenerateForm {
  weekStart: string;
  timeZone: string;
  dryRun: boolean;
}

export interface FormErrors {
  weekStart?: string;
  timeZone?: string;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function validateGenerateForm(form: GenerateForm, today: Date = new Date()): FormErrors {
  const errors: FormErrors = {};
  if (form.weekStart) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.weekStart);
    const date = match ? new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!)) : null;
    if (!match || !date || date.toISOString().slice(0, 10) !== form.weekStart) {
      errors.weekStart = "Enter a valid date.";
    } else if (date.getTime() > today.getTime() + 86_400_000) {
      errors.weekStart = "Choose a week that has already started.";
    }
  }
  if (form.timeZone && !isValidTimeZone(form.timeZone)) {
    errors.timeZone = "Enter a valid time zone, for example Europe/London.";
  }
  return errors;
}
