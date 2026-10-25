import type {FontInternals,FontParser,FontDef,StyleFunction,StyleResult} from './mathjax-font-types';
import {unicodeMathGreek} from './unicode-math-greek';
import {extraLetterStyles} from './letter-variants';
// Adapted from Davide Cervone's MathJax #3536 workaround (2026-03-22).
// https://github.com/mathjax/MathJax/issues/3536#issuecomment-4106084339
// Keep isolated: this uses MathJax internals and must be retested on upgrades.
export function installUnicodeFonts(internals:FontInternals):void {
  const {TeX} = internals.input.tex_ts;

  Object.assign(TeX.OPTIONS, {
    mathStyleGreekLC: false,       // Whether the original \mathrm, \mathbf, etc. macros adjust lowercase Greek
    mathStyleMathAlphabets: false, // Whether \symup, \mathup, etc., adjust explit Math Alphanumeric chars
  });
  
  const ParseMethods = internals.input.tex.ParseMethods.default;
  const ParseOptions = internals.input.tex.ParseOptions.default;
  const {ParseUtil} = internals.input.tex.ParseUtil;
  
  Object.assign(ParseMethods, {
    variable(parser:FontParser, c:string) {
      const def = ParseUtil.getFontDef(parser);
      const env = parser.stack.env;
      if (env.multiLetterIdentifiers && env.font !== '') {
        c = parser.string.substring(parser.i - 1).match(env.multiLetterIdentifiers)?.[0] || c;
        parser.i += c.length - 1;
        if (def.mathvariant === MATHVARIANT.NORMAL && env.noAutoOP && c.length > 1) def.autoOP = false;
      }
      if (MathStyle.isLatinOrGreekChar(c, parser)) c = MathStyle.setVariant(c, parser, def);
      parser.Push(parser.create('token', 'mi', def, c));
    },
    lcGreek(parser:FontParser, mchar:{char:string}) {
      const def:FontDef = {};
      const c = MathStyle.setVariant(mchar.char, parser, def);
      parser.Push(parser.create('token', 'mi', def, c));
    },
    ucGreek(parser:FontParser, mchar:{char:string}) {
      const def:FontDef = {};
      const c = MathStyle.setVariant(mchar.char, parser, def, true);
      parser.Push(parser.create('token', 'mi', def, c));
    },
  });

  const TexParser = internals.input.tex.TexParser.default;
  const {TexConstant} = internals.input.tex.TexConstants;
  
  const MATHVARIANT = TexConstant.Variant;
  
  const MathStyle = {
    LatinPattern: /[a-zA-Z]/,
    LatinLcPattern: /[a-z]/,
    // Include variant epsilon/kappa/phi as well as partial and nabla; the
    // upstream example omitted these from its literal-character detection.
    GreekPattern: /[\u0391-\u03A9\u03F4\u03B1-\u03C9\u03D1\u03D5\u03D6\u03F0\u03F1\u03F5\u2202\u2207]/,
    GreekUcPattern: /[\u0391-\u03A9\u03F4\u2207]/,
    GreekLcPattern: /[\u03B1-\u03C9\u03D1\u03D5\u03D6\u03F0\u03F1\u03F5\u2202]/,
    MathLatinPattern: /[\u{1D400}-\u{1D49B}\u{1D5A0}-\u{1D66F}\u210E]/u,
    MathGreekPattern: /[\u{1D6A8}-\u{1D7C9}]/u,
    MathAlphaPattern: /[\u{1D400}-\u{1D49B}\u{1D5A0}-\u{1D66F}\u210E\u{1D6A8}-\u{1D7C9}]/u,
    
    mathAlpha: new Map<string,[number,number,number,string?][]>([
      ['TeX', [
        [0x1D6C2, 0x1D6E1, 0x1D736],
        [0x1D468, 0x1D49B, 0x1D400],
        [0x1D71C, 0x1D735, 0x1D6A8],
        [0x1D63C, 0x1D66F, 0x1D5D4],
        [0x1D790, 0x1D7C9, 0x1D756],
        [0x1D608, 0x1D63B, 0x1D5A0],
        [0x1D6E2, 0x1D6FA, 0x391, MATHVARIANT.NORMAL],
      ]],
      ['ISO', [
        [0x1D400, 0x1D433, 0x1D468],
        [0x1D6A8, 0x1D6E1, 0x1D71C],
        [0x1D5D4, 0x1D607, 0x1D63C],
        [0x1D756, 0x1D78F, 0x1D790],
        [0x1D5A0, 0x1D5D3, 0x1D608],
      ]],
      ['upright', [
        [0x1D434, 0x1D44D, 0x41, MATHVARIANT.NORMAL],
        [0x1D44E, 0x1D467, 0x61, MATHVARIANT.NORMAL],
        [0x1D6E2, 0x1D6FA, 0x391, MATHVARIANT.NORMAL],
        [0x1D6FC, 0x1D714, 0x3B1, MATHVARIANT.NORMAL],
        [0x1D468, 0x1D49B, 0x1D400],
        [0x1D71C, 0x1D755, 0x1D6A8],
        [0x1D63C, 0x1D66F, 0x1D5D4],
        [0x1D790, 0x1D7C9, 0x1D756],
        [0x1D608, 0x1D63B, 0x1D5A0],
      ]],
      ['french', [
        [0x1D434, 0x1D44D, 0x41, MATHVARIANT.NORMAL],
        [0x1D6E2, 0x1D6FA, 0x391, MATHVARIANT.NORMAL],
        [0x1D6FC, 0x1D714, 0x3B1, MATHVARIANT.NORMAL],
        [0x1D468, 0x1D49B, 0x1D400],
        [0x1D71C, 0x1D755, 0x1D6A8],
        [0x1D63C, 0x1D66F, 0x1D5D4],
        [0x1D790, 0x1D7C9, 0x1D756],
        [0x1D608, 0x1D63B, 0x1D5A0],
      ]],
      ['literal', []],
    ]),
    
    mathAlphaMap: new Map<string,Map<number,StyleResult>>([
      ['TeX', new Map([
        [0x1D6F3, [MATHVARIANT.NORMAL, '\u03F4']],
        [0x1D6FB, [MATHVARIANT.NORMAL, '\u2207']],
      ])],
      ['upright', new Map([
        [0x0210E, [MATHVARIANT.NORMAL, 'h']],
        [0x1D6F3, [MATHVARIANT.NORMAL, '\u03F4']],
        [0x1D6FB, [MATHVARIANT.NORMAL, '\u2207']],
        [0x1D715, [MATHVARIANT.NORMAL, '\u2202']],
        [0x1D716, [MATHVARIANT.NORMAL, '\u03F5']],
        [0x1D717, [MATHVARIANT.NORMAL, '\u03D1']],
        [0x1D718, [MATHVARIANT.NORMAL, '\u03F0']],
        [0x1D719, [MATHVARIANT.NORMAL, '\u03D5']],
        [0x1D71A, [MATHVARIANT.NORMAL, '\u03F1']],
        [0x1D71B, [MATHVARIANT.NORMAL, '\u03D6']],
      ])],
      ['french', new Map([
        [0x1D6F3, [MATHVARIANT.NORMAL, '\u03F4']],
        [0x1D6FB, [MATHVARIANT.NORMAL, '\u2207']],
        [0x1D715, [MATHVARIANT.NORMAL, '\u2202']],
        [0x1D716, [MATHVARIANT.NORMAL, '\u03F5']],
        [0x1D717, [MATHVARIANT.NORMAL, '\u03D1']],
        [0x1D718, [MATHVARIANT.NORMAL, '\u03F0']],
        [0x1D719, [MATHVARIANT.NORMAL, '\u03D5']],
        [0x1D71A, [MATHVARIANT.NORMAL, '\u03F1']],
        [0x1D71B, [MATHVARIANT.NORMAL, '\u03D6']],
      ])],
    ]),
    
    styleFunction: new Map<string,StyleFunction>([
      ['TeX',
        ({c, C, font, afont, b}):StyleResult => [
          b && C.match(MathStyle.GreekUcPattern) ? font
            : C.match(MathStyle.GreekLcPattern) || b ? afont : '',
          c
      ]],
      ['ISO', ({c, C, ifont, afont}):StyleResult => [C.match(MathStyle.GreekPattern) ? afont : ifont, c]],
      ['french',
        ({c, C, font, ifont}):StyleResult => [C.match(MathStyle.LatinLcPattern) ? ifont : font, c],
      ],
      ['upright', ({c, font}):StyleResult => [font, c]],
      ['literal', ({c, font}):StyleResult => [font || MATHVARIANT.NORMAL, c]],
    ]),
    
    convertMathAlpha(style:string, c:string):StyleResult {
      const n = c.codePointAt(0)!;
      const map = MathStyle.mathAlphaMap.get(style);
      if (map?.has(n)) return map.get(n)!;
      for (const [m, M, N, variant = ''] of MathStyle.mathAlpha.get(style) || []) {
        if (n >= m && n <= M) {
          const C = N + (n - m);
          return [variant, String.fromCodePoint(C)];
        }
      }
      return ['', c];
    },
    
    isLatinOrGreekChar(c:string, parser:FontParser) {
      const C = [...c.normalize('NFC')][0];
      return (!!C.match(this.LatinPattern) || !!C.match(this.GreekPattern)
        || (parser.configuration.options.mathStyleMathAlphabets && !!C.match(this.MathAlphaPattern))
      );
    },
    
    setVariant(c:string, parser:FontParser, def:FontDef, b = false) {
      const options = parser.configuration.options;
      const env = parser.stack.env;
      const font = env.font || '';
      if(extraLetterStyles.some(([, ,variant])=>variant===font)){
        def.mathvariant=font;return c;
      }
      const greek = unicodeMathGreek(c, env.unicodeMathCommands || [], options.mathStyle || 'TeX');
      if (greek !== undefined && (env.unicodeMathCommands || !font)) {
        // Resolve before the output font's variant fallbacks (which otherwise
        // synthesize bold/script/Sans Greek that unicode-math does not select).
        def.mathvariant = MATHVARIANT.NORMAL;
        return greek;
      }
      const ifont = env.italicFont || font || MATHVARIANT.ITALIC;
      const afont = env.altItalicFont || ifont;
      const C = [...c.normalize('NFC')][0];
      if (font && !options.mathStyleGreekLC && !env.mathStyleGreekLC && C.match(this.GreekLcPattern)) {
        def.mathvariant = MATHVARIANT.ITALIC;
        return c;
      }
      const [variant, char] = (options.mathStyleMathAlphabets && !!C.match(this.MathAlphaPattern))
        ? this.convertMathAlpha(parser.configuration.options.mathStyle || 'TeX', c)
        : parser.configuration.mathStyle.call(MathStyle, {c, C, font: font || MATHVARIANT.NORMAL, ifont, afont, b});
        if (variant) def.mathvariant = variant;
      return char;
    }
  };
  MathStyle.mathAlpha.set('French', MathStyle.mathAlpha.get('french')!);
  MathStyle.mathAlphaMap.set('French', MathStyle.mathAlphaMap.get('french')!);
  MathStyle.styleFunction.set('French', MathStyle.styleFunction.get('french')!);

  ParseOptions.getVariant = MathStyle.styleFunction;
  TexConstant.Variant.DOUBLESTRUCKITALIC = '-double-struck-italic';
  
  const {BaseConfiguration} = internals.input.tex.base.BaseConfiguration;
  const BaseMethods = internals.input.tex.base.BaseMethods.default;
  const {MapHandler} = internals.input.tex.MapHandler;
  const {Macro} = internals.input.tex.Token;
  const {getRange} = internals.core.MmlTree.OperatorDictionary;
  const NodeUtil = internals.input.tex.NodeUtil.default;
  
  Object.assign(BaseMethods, {
    MathFont(parser:FontParser, name:string, variant:string, italic:string = '', altItalic = '', greekLC = true) {
      const text = parser.GetArgument(name);
      const mml = new TexParser(text, {
        multiLetterIdentifiers: parser.options.identifierPattern,
        ...parser.stack.env,
        unicodeMathCommands: [...(parser.stack.env.unicodeMathCommands || []), name.replace(/^\\/, '').replace(/^(sym|math)/, '')],
        font: variant,
        italicFont: italic || variant,
        altItalicFont: altItalic || italic || variant,
        mathStyleGreekLC: greekLC,
        noAutoOP: true,
      }, parser.configuration).mml();
      parser.Push(parser.create('node', 'TeXAtom', [mml]));
    },
    SetFont(parser:FontParser, _name:string, font:string) {
      parser.stack.env['font'] = font;
      parser.stack.env.unicodeMathCommands = undefined;
      parser.stack.env['italicFont'] = font;
      parser.stack.env['altItalicFont'] = font;
      parser.stack.env['mathStyleGreekLC'] = false;
      parser.Push(parser.itemFactory.create('null'));
    },
  });

  BaseConfiguration.fallback.character = function Other(parser:FontParser, char:string) {
    const remap = MapHandler.getMap('remap').lookup(char);
    const range = getRange(char);
    const type = range[3];
    const font = range[4] || parser.stack.env.font;
    const def = font ? { mathvariant: font } : {};
    if (MathStyle.isLatinOrGreekChar(char, parser)) {
      char = MathStyle.setVariant(char, parser, def, true);
    }
    const mo = parser.create('token', type, def, remap ? remap.char : char);
    if (type === 'mo') {
      NodeUtil.setProperty(mo, 'fixStretchy', true);
      parser.configuration.addNode('fixStretchy', mo);
    }
    parser.Push(mo);
  };
  
  const VARIANT = TexConstant.Variant;
  const macros = MapHandler.getMap('macros');
  for (const name of ['mathnormal', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal']) {
    macros.lookup(name)._args.push('', '', false);
  }
  for (const [name, args] of Object.entries({
    symbb: ['', VARIANT.DOUBLESTRUCKITALIC],
    symfrak: ['', VARIANT.ITALIC],
    symbffrak: ['', VARIANT.BOLDITALIC],
    symbfsf: [VARIANT.SANSSERIFBOLDITALIC],
    symtt: ['', VARIANT.ITALIC],
  })) {
    macros.lookup(name)._args.push(...args);
  }
  for (const name of ['normal', 'rm', 'up', 'bf', 'bfup', 'it', 'bfit', 'bb',
                      'frak', 'bffrak', 'scr', 'bfscr', 'sf', 'sfup', 'bfsf', 'bfsfup',
                      'sfit', 'bfsfit', 'tt', 'cal', 'bfcal']) {
    macros.lookup('sym' + name)._func  = BaseMethods.MathFont;
    macros.lookup('math' + name)._func = BaseMethods.MathFont;
  }
  macros.lookup('frak')._func = macros.lookup('Bbb')._func = BaseMethods.MathFont;
  macros.add('symbbit', new Macro('symbbit', BaseMethods.MathFont, [VARIANT.DOUBLESTRUCKITALIC]));
  macros.add('mathbbit', new Macro('mathbbit', BaseMethods.MathFont, [VARIANT.DOUBLESTRUCKITALIC]));
  // Retired styles are read-only draft compatibility; active BBoldX uses its native package.
  for(const [name,,variant] of extraLetterStyles)if(name!=='editorbboldx'&&name!=='editorbboldxbold')macros.add(name,new Macro(name,BaseMethods.MathFont,[variant]));
  for (const name of ['rm', 'bf', 'it', 'sf', 'tt', 'cal', 'mit', 'oldstyle']) {
    macros.lookup(name)._func = BaseMethods.SetFont;
  }
  
  MapHandler.getMap('letter')._parser  = ParseMethods.variable;
  MapHandler.getMap('lcGreek')._parser = ParseMethods.lcGreek;
  MapHandler.getMap('ucGreek')._parser = ParseMethods.ucGreek;

  // AMS varkappa and base partial/nabla use symbol maps, not lcGreek/ucGreek.
  // Apply the same upstream style resolver there without changing other symbols.
  for (const name of ['mathchar0mi', 'AMSsymbols-mathchar0mi']) {
    const map=MapHandler.getMap(name);
    if (!map) continue;
    const original=map._parser as (parser:FontParser,token:{char:string;attributes?:FontDef})=>void;
    map._parser=(parser:FontParser,token:{char:string;attributes?:FontDef})=>{
      if (!MathStyle.GreekPattern.test(token.char)) return original(parser,token);
      const def:FontDef={...token.attributes};
      const char=MathStyle.setVariant(token.char,parser,def,MathStyle.GreekUcPattern.test(token.char));
      parser.Push(parser.create('token','mi',def,char));
    };
  }
  
  const font = Object.values(Object.values(internals.output.fonts)[0].chtml_ts)[0];
  font.defaultVariants.push(['-double-struck-italic', 'double-struck', 'bold-italic']);
  font.defaultCssFonts['-double-struck-italic'] = ['unknown', true, true];
  font.VariantSmp['double-struck'][5] = {
    0x0393: 0x213E,
    0x03A0: 0x213F,
    0x03B3: 0x213D,
    0x03C0: 0x213C,
  };
  font.VariantSmp['-double-struck-italic'] = [0x1D538, 0x1D552 , , , 0x1D7D8, {
    0x44: 0x2145,
    0x64: 0x2146,
    0x65: 0x2147,
    0x69: 0x2148,
    0x6A: 0x2149,
    0x0393: 0x213E,
    0x03A0: 0x213F,
    0x03B3: 0x213D,
    0x03C0: 0x213C,
  }];
  
}

