'use client';

import { createPlatePlugin } from 'platejs/react';
import {createPortal} from 'react-dom';
import {t} from '@/i18n';

import { FixedToolbar } from '@/components/ui/fixed-toolbar';
import { FixedToolbarButtons } from '@/components/ui/fixed-toolbar-buttons';

export const FixedToolbarKit = [
  createPlatePlugin({
    key: 'fixed-toolbar',
    render: {
      beforeEditable: () => {
        const target=document.getElementById('documentTools');
        if(!target)return null;
        return createPortal(<FixedToolbar aria-label={t('Document tools')}>
          <FixedToolbarButtons />
        </FixedToolbar>,target);
      },
    },
  }),
];
