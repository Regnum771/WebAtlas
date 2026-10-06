import { useCallback, useRef, useState } from 'react';
import { useSession } from '../../../entities/session/model/session.store';
import { ApiError } from '../../../shared/api/apiClient';
import { useFormFields } from '../../../shared/ui/useFormFields';
import { validateEmail, validatePassword } from './loginValidation';

export type LoginField = 'email' | 'password';

export interface LoginFormError {
  title: string;
  body: string;
}

const VALIDATORS = { email: validateEmail, password: validatePassword };

function formErrorFor(e: unknown): LoginFormError {
  if (e instanceof ApiError) {
    if (e.status === 401) return { title: 'Email hoặc mật khẩu không đúng', body: 'Kiểm tra lại rồi thử lần nữa.' };
    if (e.status === 429) return { title: 'Thử quá nhiều lần', body: 'Đợi một lát rồi thử lại.' };
    if (e.status === 0 || e.code === 'NETWORK_ERROR') {
      return { title: 'Không kết nối được máy chủ', body: 'Kiểm tra mạng rồi thử lại.' };
    }
  }
  return { title: 'Chưa đăng nhập được', body: 'Thử lại sau.' };
}

export function useLoginPresenter(onSuccess?: () => void) {
  const { login } = useSession();
  const { values, errors, set, blur, validateAll } = useFormFields({ email: '', password: '' }, VALIDATORS);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<LoginFormError | null>(null);
  // True from the moment a request starts until it settles; blocks a second request.
  const inFlight = useRef(false);
  // Latest values, readable from the stable callback below.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const submit = useCallback((): LoginField | null => {
    if (inFlight.current) return null;
    const invalid = validateAll();
    if (invalid) return invalid;
    inFlight.current = true;
    setLoading(true);
    setFormError(null);
    const { email, password } = valuesRef.current;
    login({ email, password }).then(
      () => {
        inFlight.current = false;
        setLoading(false);
        onSuccess?.();
      },
      (e: unknown) => {
        inFlight.current = false;
        setLoading(false);
        setFormError(formErrorFor(e));
      },
    );
    return null;
  }, [login, onSuccess, validateAll]);

  return { values, errors, set, blur, loading, formError, submit };
}
