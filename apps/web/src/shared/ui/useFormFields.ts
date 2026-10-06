import { useCallback, useRef, useState } from 'react';

export type Validators<K extends string> = Record<K, (value: string) => string | null>;

/** Field state with check-on-blur; a field that shows an error rechecks on every keystroke. */
export function useFormFields<K extends string>(initial: Record<K, string>, validators: Validators<K>) {
  const [values, setValues] = useState<Record<K, string>>(initial);
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  // Refs mirror state so calls made in the same tick see the latest values.
  const valuesRef = useRef(values);
  const errorsRef = useRef(errors);
  // Validators are read through a ref so callers may pass a fresh object each render.
  const validatorsRef = useRef(validators);
  validatorsRef.current = validators;

  const writeErrors = useCallback((next: Partial<Record<K, string>>) => {
    errorsRef.current = next;
    setErrors(next);
  }, []);

  const check = useCallback(
    (name: K, value: string) => {
      const message = validatorsRef.current[name](value);
      const next = { ...errorsRef.current };
      if (message) next[name] = message;
      else delete next[name];
      writeErrors(next);
    },
    [writeErrors],
  );

  const set = useCallback(
    (name: K, value: string) => {
      valuesRef.current = { ...valuesRef.current, [name]: value };
      setValues(valuesRef.current);
      if (errorsRef.current[name]) check(name, value);
    },
    [check],
  );

  const blur = useCallback((name: K) => check(name, valuesRef.current[name]), [check]);

  const validateAll = useCallback((): K | null => {
    let first: K | null = null;
    const next: Partial<Record<K, string>> = {};
    for (const name of Object.keys(validatorsRef.current) as K[]) {
      const message = validatorsRef.current[name](valuesRef.current[name]);
      if (message) {
        next[name] = message;
        if (first === null) first = name;
      }
    }
    writeErrors(next);
    return first;
  }, [writeErrors]);

  return { values, errors, set, blur, validateAll };
}
