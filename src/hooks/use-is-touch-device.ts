'use client';

import * as React from 'react';

export function useIsTouchDevice() {
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);

  React.useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const fine = window.matchMedia('(any-pointer: fine)');
    function update() {
      setIsTouchDevice(coarse.matches && !fine.matches);
    }
    coarse.addEventListener('change', update);
    fine.addEventListener('change', update);
    update();
    return () => {
      coarse.removeEventListener('change', update);
      fine.removeEventListener('change', update);
    };
  }, []);

  return isTouchDevice;
}
