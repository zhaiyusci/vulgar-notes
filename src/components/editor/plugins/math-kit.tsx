'use client';

import { EquationPlugin, InlineEquationPlugin } from '@platejs/math/react';

import { MathEquationElement as EquationElement, MathEquationElement as InlineEquationElement } from '@/plate-math-element';

export const MathKit = [
  InlineEquationPlugin.configure({
    node: {
      component: InlineEquationElement,
    },
  }),
  EquationPlugin.configure({
    node: {
      component: EquationElement,
    },
  }),
];
