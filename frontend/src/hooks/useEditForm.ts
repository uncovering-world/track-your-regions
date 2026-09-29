/**
 * One form layer for the dialogs that edit data (ADR-0076, #1129): a dialog
 * declares its fields, and this holds their values, which of them changed,
 * what is sent, and why the server refused a save — field by field.
 *
 * The rules it owns, stated once instead of per dialog:
 *
 * - **What changed.** A field is changed when its tidied value differs from
 *   the stored one it opened on. Strings are tidied by trimming unless the
 *   dialog names its own tidy (`tidyLabel` for a name), so a stray space is
 *   not an edit.
 * - **What is sent.** Exactly the changed fields, each as its tidied value. A
 *   field emptied by the user is sent as `''` — never dropped as `undefined`,
 *   which `JSON.stringify` leaves out, so the server never heard of the
 *   removal (#696, #1133). A create dialog opens on blanks, so the same rule
 *   sends what was filled in and nothing else.
 * - **Why a save failed.** A refusal's field issues (`ApiError.fieldIssues`)
 *   are shown on the field whose body key they name; what names no field is
 *   the form's own error. Validation stays the server's: the client does not
 *   restate its schema.
 *
 * Field names are the request body's keys, so a dialog types the hook with the
 * generated body type (`EditExperienceBody`) and `changes()` is a
 * `Partial` of it; where a body path differs from the field that shows it
 * (`latitude` for a coordinate box), `paths` maps it.
 */

import { useRef, useState, type ChangeEvent } from 'react';
import { ApiError } from '../api/fetchUtils';

type Fields = Record<string, unknown>;

export interface EditFormOptions<F extends Fields> {
  /** The stored values (an edit) or blanks (a create). Rebuilt per render is fine: compared by value. */
  initial: F;
  /** A change of this — `experience?.id`, `open && worldView.id` — starts the form over. A primitive. */
  resetKey?: string | number | boolean | null;
  /** How a field is tidied before it is compared and sent; strings are trimmed by default. */
  tidy?: { [K in keyof F]?: (value: F[K]) => F[K] };
  /** Fields that may not be blank (after tidying) for the form to be sent. */
  required?: readonly (keyof F)[];
  /** A body path that names a field under another key: `{ latitude: 'coords' }`. */
  paths?: Readonly<Record<string, keyof F>>;
}

export interface FieldProps<V> {
  value: V;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  error: boolean;
  helperText: string | undefined;
}

export interface EditForm<F extends Fields> {
  values: F;
  set: <K extends keyof F>(key: K, value: F[K]) => void;
  /** The props a text field takes: its value, its setter, and its error over `helperText`. */
  field: <K extends keyof F>(key: K, opts?: { helperText?: string }) => FieldProps<F[K]>;
  isDirty: (key: keyof F) => boolean;
  /** Whether any field changed. */
  dirty: boolean;
  /** Whether a required field is blank. */
  missing: boolean;
  /** The changed fields as they would be sent, optionally narrowed to some. */
  changes: (only?: readonly (keyof F)[]) => Partial<F>;
  errors: Partial<Record<keyof F, string>>;
  formError: string | null;
  /**
   * Sends the changes through `send` (a mutation's `mutateAsync`) and answers
   * whether the save landed. On success the sent values become the ones the
   * form compares against; on a refusal each field issue lands on its field.
   * A reset while the save is in flight abandons its answer: it lands nowhere
   * and `submit` answers false.
   */
  submit: (send: (changes: Partial<F>) => Promise<unknown>, only?: readonly (keyof F)[]) => Promise<boolean>;
  resetField: (key: keyof F) => void;
  reset: () => void;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function isBlank(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
}

export function useEditForm<F extends Fields>(options: EditFormOptions<F>): EditForm<F> {
  const { initial, resetKey = null, tidy, required = [], paths = {} } = options;
  const keys = Object.keys(initial) as (keyof F)[];
  const signature = JSON.stringify(initial);

  const [values, setValues] = useState<F>(initial);
  const [baseline, setBaseline] = useState<F>(initial);
  const [touched, setTouched] = useState<ReadonlySet<keyof F>>(() => new Set());
  const [errors, setErrors] = useState<Partial<Record<keyof F, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Moved on by every reset, so a save answered after one is dropped rather
  // than turning up under a field the user has since put back or left.
  const generation = useRef(0);

  // Adjusted during render rather than in an effect, so a dialog never paints
  // one frame of the previous object's values: a new key starts the form
  // over; new stored values under the same key (a detail read arriving late,
  // the refetch after a save) move the fields whose stored value moved,
  // unless the user has touched them. A field whose stored value did not move
  // keeps what it holds: a caller often passes some fields from a snapshot
  // that no save refreshes, and a refetch of the others must not put that
  // snapshot back over a value the form has just sent.
  const [tracked, setTracked] = useState({ key: resetKey, signature, initial });
  if (tracked.key !== resetKey) {
    generation.current++;
    setTracked({ key: resetKey, signature, initial });
    setValues(initial);
    setBaseline(initial);
    setTouched(new Set());
    setErrors({});
    setFormError(null);
  } else if (tracked.signature !== signature) {
    const moved = keys.filter(k => !same(initial[k], tracked.initial[k]));
    setTracked({ key: resetKey, signature, initial });
    setBaseline(prev => {
      const next = { ...prev };
      for (const k of moved) next[k] = initial[k];
      return next;
    });
    setValues(prev => {
      const next = { ...prev };
      for (const k of moved) if (!touched.has(k)) next[k] = initial[k];
      return next;
    });
  }

  const tidied = <K extends keyof F>(key: K, value: F[K]): F[K] => {
    const own = tidy?.[key];
    if (own) return own(value);
    return (typeof value === 'string' ? value.trim() : value) as F[K];
  };

  const isDirty = (key: keyof F) => !same(tidied(key, values[key]), tidied(key, baseline[key]));

  const changes = (only?: readonly (keyof F)[]): Partial<F> => {
    const out: Partial<F> = {};
    for (const k of only ?? keys) if (isDirty(k)) out[k] = tidied(k, values[k]);
    return out;
  };

  const set = <K extends keyof F>(key: K, value: F[K]) => {
    setValues(prev => ({ ...prev, [key]: value }));
    // A field typed back to its stored value is untouched again, so a newer
    // stored value can still reach it rather than the old one being sent over it.
    setTouched(prev => {
      const next = new Set(prev);
      if (same(tidied(key, value), tidied(key, baseline[key]))) next.delete(key);
      else next.add(key);
      return next;
    });
    setErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const fieldOf = (path: string): keyof F | undefined => {
    if (path in paths) return paths[path];
    if (keys.includes(path)) return path;
    const head = path.split('.')[0];
    return keys.includes(head) ? head : undefined;
  };

  const readRefusal = (err: unknown) => {
    const fieldErrors: Partial<Record<keyof F, string>> = {};
    if (!(err instanceof ApiError)) {
      return { fieldErrors, rest: err instanceof Error && err.message ? err.message : 'Could not save' };
    }
    if (err.fieldIssues.length === 0) return { fieldErrors, rest: err.message };
    const unplaced: string[] = [];
    for (const issue of err.fieldIssues) {
      const key = fieldOf(issue.path);
      if (key === undefined) unplaced.push(issue.path ? `${issue.path}: ${issue.message}` : issue.message);
      else fieldErrors[key] ??= issue.message;
    }
    const rest = unplaced.length > 0 ? `${err.sentence ?? 'Refused'} — ${unplaced.join('; ')}` : null;
    return { fieldErrors, rest };
  };

  const submit = async (send: (changes: Partial<F>) => Promise<unknown>, only?: readonly (keyof F)[]) => {
    const sent = changes(only);
    const thisSave = generation.current;
    setErrors({});
    setFormError(null);
    try {
      await send(sent);
    } catch (err) {
      if (thisSave !== generation.current) return false;
      const { fieldErrors, rest } = readRefusal(err);
      setErrors(fieldErrors);
      setFormError(rest);
      return false;
    }
    if (thisSave !== generation.current) return false;
    // What was sent is now what is stored: compare against it, and let the
    // next stored value reach these fields again.
    setBaseline(prev => ({ ...prev, ...sent }));
    setTouched(prev => {
      const next = new Set(prev);
      for (const k of Object.keys(sent)) next.delete(k);
      return next;
    });
    return true;
  };

  const resetField = (key: keyof F) => {
    generation.current++;
    setValues(prev => ({ ...prev, [key]: baseline[key] }));
    setTouched(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFormError(null);
  };

  const reset = () => {
    generation.current++;
    setValues(baseline);
    setTouched(new Set());
    setErrors({});
    setFormError(null);
  };

  const field = <K extends keyof F>(key: K, opts?: { helperText?: string }): FieldProps<F[K]> => ({
    value: values[key],
    onChange: event => set(key, event.target.value as F[K]),
    error: errors[key] !== undefined,
    helperText: errors[key] ?? opts?.helperText,
  });

  return {
    values,
    set,
    field,
    isDirty,
    dirty: keys.some(isDirty),
    missing: required.some(k => isBlank(tidied(k, values[k]))),
    changes,
    errors,
    formError,
    submit,
    resetField,
    reset,
  };
}
