'use client';

import { MathRules } from '@platejs/math';
import { EquationPlugin, InlineEquationPlugin } from '@platejs/math/react';

import { MathEquationElement as EquationElement, MathEquationElement as InlineEquationElement } from '@/plate-math-element';

export const MathKit = [
  InlineEquationPlugin.configure({
    inputRules: [MathRules.markdown({ variant: '$' })],
    node: {
      component: InlineEquationElement,
    },
  }),
  EquationPlugin.configure({
    inputRules: [MathRules.markdown({ on: 'break', variant: '$$' })],
    node: {
      component: EquationElement,
    },
  }),
];
