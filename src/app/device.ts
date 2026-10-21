import { useEffect, useState } from 'react';

/**
 * The device in front of the studio. Who may administer it is access.ts's
 * (one model with accounts or without); this file only says whether it is a
 * phone, which gets the simplified phone studio unless someone chose the full
 * one.
 */

/** The phone layout's width breakpoint, shared with the CSS (max-width: 760px). */
export const NARROW_QUERY = '(max-width: 760px)';
// Narrow, or short (a phone held sideways is wide but only ~400px tall).
export const PHONE_QUERY = `(pointer: coarse) and ${NARROW_QUERY}, (pointer: coarse) and (max-height: 500px)`;

/** Phones say so in their user agent; tablets and touch laptops do not. */
function mobileAgent() {
  if (typeof navigator === 'undefined') return false;
  const hint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  if (typeof hint === 'boolean') return hint;
  return /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari(?!.*iPad)/i.test(navigator.userAgent) && !/iPad/i.test(navigator.userAgent);
}

function phoneNow(query: MediaQueryList) {
  return forcedPhone() || query.matches || (mobileAgent() && window.matchMedia('(pointer: coarse)').matches);
}

// ?phone=1 forces the phone studio (and ?phone=0 turns the force off) for this
// tab, so it can be tried or checked on a desktop.
export function forcedPhone() {
  if (typeof window === 'undefined') return false;
  try {
    const flag = new URLSearchParams(window.location.search).get('phone');
    if (flag !== null) window.sessionStorage.setItem('studio-force-phone', flag === '1' ? '1' : '');
    return window.sessionStorage.getItem('studio-force-phone') === '1';
  } catch {
    return false;
  }
}

/** A touch phone: coarse pointer on a narrow screen. Tablets keep the full studio. */
export function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && phoneNow(window.matchMedia(PHONE_QUERY)));
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(phoneNow(query));
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}
