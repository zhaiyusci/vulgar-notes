'use client';

import { navigate, type NavigationNavigateOptions } from 'platejs';
import { createPlatePlugin } from 'platejs/react';

// Disabling Plate's navigation feedback also removes its navigation transform.
// Endnote links still need native selection, focus and scrolling, without flash.
export const NavigationKit = [
  createPlatePlugin({ key: 'navigation' }).extendEditorTransforms(({ editor }) => ({
    navigation: {
      navigate: (options: NavigationNavigateOptions) =>
        navigate(editor, { ...options, flash: false }),
    },
  })),
];
