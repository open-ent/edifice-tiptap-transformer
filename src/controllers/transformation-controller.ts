import { Response } from 'express';
import { TransformationFormat } from '../models/format.js';
import TableOrTemplate from '../models/TableOrTemplate.js';
import TableOrTemplateCell from '../models/TableOrTemplateCell.js';
import {
  AuthenticatedRequest,
  ContentTransformerRequest,
  ContentTransformerResponse,
} from '../models/transformation-request.js';

import { generateText } from '@tiptap/core';
import { generateHTML, generateJSON } from '@tiptap/html';

import {
  AttachmentTransformer,
  ConversationHistoryBody,
} from '@open-ent/tiptap-extensions';
import { Alert } from '@open-ent/tiptap-extensions/alert';
import { Attachment } from '@open-ent/tiptap-extensions/attachment';
import { Audio } from '@open-ent/tiptap-extensions/audio';
import { ConversationHistory } from '@open-ent/tiptap-extensions/conversation-history';
import { FontSize } from '@open-ent/tiptap-extensions/font-size';
import { CustomHeading } from '@open-ent/tiptap-extensions/heading';
import { CustomHighlight } from '@open-ent/tiptap-extensions/highlight';
import { Hyperlink } from '@open-ent/tiptap-extensions/hyperlink';
import { Iframe } from '@open-ent/tiptap-extensions/iframe';
import { Image } from '@open-ent/tiptap-extensions/image';
import { InformationPane } from '@open-ent/tiptap-extensions/information-pane';
import { LineHeight } from '@open-ent/tiptap-extensions/line-height';
import { Linker } from '@open-ent/tiptap-extensions/linker';
import { MathJax } from '@open-ent/tiptap-extensions/mathjax';
import { Paragraph } from '@open-ent/tiptap-extensions/paragraph';
import { Video } from '@open-ent/tiptap-extensions/video';

import { Color } from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import {
  cleanHtmlCounter,
  cleanHtmlTimer,
  cleanJsonCounter,
  cleanJsonTimer,
  h2jCounter,
  h2jTimer,
  h2plainTextCounter,
  h2plainTextTimer,
  j2hCounter,
  j2hTimer,
  j2plainTextCounter,
  j2plainTextTimer,
  updateCounterAndTimer,
} from './metrics-controller.js';

export const EXTENSIONS = [
  StarterKit.configure({ paragraph: false }),
  Paragraph,
  CustomHighlight.configure({
    multicolor: true,
  }),
  Underline,
  TextStyle,
  Color,
  Subscript,
  Superscript,
  TableOrTemplate,
  TableRow,
  TableHeader,
  TableOrTemplateCell,
  TextAlign.configure({
    types: ['heading', 'paragraph', 'custom-image', 'video', 'audio', 'iframe'],
  }),
  CustomHeading.configure({
    levels: [1, 2],
  }),
  Typography,
  FontSize,
  LineHeight,
  Iframe,
  Hyperlink,
  FontFamily,
  MathJax,
  Alert,
  Video,
  Audio,
  Linker,
  Image,
  Attachment,
  AttachmentTransformer,
  InformationPane,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ADDITIONAL_EXTENSIONS = new Map<string, any[] | any>([
  ['conversation-history', [ConversationHistory, ConversationHistoryBody]],
]);

export function transformController(
  req: AuthenticatedRequest,
  res: Response,
  serviceVersion: number,
): Promise<void> {
  const data: ContentTransformerRequest = req.body as ContentTransformerRequest;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let extensions: any[] = [...EXTENSIONS];
  if (
    data.additionalExtensionIds !== null &&
    data.additionalExtensionIds !== undefined &&
    data.additionalExtensionIds.length > 0
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const additionalExtensions: any[] = [];
    data.additionalExtensionIds.forEach((extensionId) => {
      const extTmp = ADDITIONAL_EXTENSIONS.get(extensionId);
      if (extTmp) {
        if (Array.isArray(extTmp)) {
          additionalExtensions.push(...extTmp);
        } else {
          additionalExtensions.push(extTmp);
        }
      }
    });
    extensions = [...extensions, ...additionalExtensions];
  }
  let generatedHtmlContent;
  let generatedJsonContent;
  let plainTextContent;
  let cleanHtml;
  let cleanJson;
  if (!data.htmlContent && !data.jsonContent) {
    res.status(400);
    res.json({ error: 'No specified content to transform.' });
    return Promise.resolve();
  } else {
    if (data.requestedFormats.includes(TransformationFormat.HTML)) {
      // Transforming content to HTML
      if (data.jsonContent != null) {
        const start = Date.now();
        generatedHtmlContent = generateHTML(data.jsonContent, extensions);
        updateCounterAndTimer(start, j2hCounter, j2hTimer);
      }
      // Cleaning HTML content
      if (data.htmlContent != null) {
        const start = Date.now();
        cleanHtml = generateHTML(
          generateJSON(data.htmlContent, extensions),
          extensions,
        );
        updateCounterAndTimer(start, cleanHtmlCounter, cleanHtmlTimer);
      }
    }
    if (data.requestedFormats.includes(TransformationFormat.JSON)) {
      // Transforming content to JSON
      if (data.htmlContent != null) {
        const start = Date.now();
        generatedJsonContent = generateJSON(data.htmlContent, extensions);
        updateCounterAndTimer(start, h2jCounter, h2jTimer);
      }
      // Cleaning JSON content
      if (data.jsonContent != null) {
        const start = Date.now();
        cleanJson = generateJSON(
          generateHTML(data.jsonContent, extensions),
          extensions,
        );
        updateCounterAndTimer(start, cleanJsonCounter, cleanJsonTimer);
      }
    }
    // Transforming content to PLAIN TEXT
    if (data.requestedFormats.includes(TransformationFormat.PLAINTEXT)) {
      if (data.jsonContent != null) {
        const start = Date.now();
        plainTextContent = generateText(data.jsonContent, extensions);
        updateCounterAndTimer(start, j2plainTextCounter, j2plainTextTimer);
      } else if (data.htmlContent != null) {
        const start = Date.now();
        if (generatedJsonContent != null) {
          plainTextContent = generateText(generatedJsonContent, extensions);
        } else {
          plainTextContent = generateText(
            generateJSON(data.htmlContent, extensions),
            extensions,
          );
        }
        updateCounterAndTimer(start, h2plainTextCounter, h2plainTextTimer);
      }
    }
    const response: ContentTransformerResponse = {
      contentVersion: serviceVersion,
      htmlContent: generatedHtmlContent,
      jsonContent: generatedJsonContent,
      plainTextContent: plainTextContent,
      cleanHtml: cleanHtml,
      cleanJson: cleanJson,
    } as ContentTransformerResponse;
    res.json(response);
    return Promise.resolve();
  }
}

export function healthCheck(res: Response) {
  let result: { success: boolean; message: string } = {
    success: true,
    message: 'ok',
  };
  let resCode = 200;
  try {
    generateJSON(SAMPLE_HTML, EXTENSIONS);
  } catch (e) {
    console.error(`msg="Cannot generate json"`);
    console.error(e);
    resCode = 500;
    result = { success: false, message: 'cannot.generate.json' };
  }
  if (resCode === 200) {
    try {
      generateHTML(SAMPLE_JSON, EXTENSIONS);
    } catch (e) {
      console.error(`msg="Cannot generate json"`);
      console.error(e);
      resCode = 500;
      result = { success: false, message: 'cannot.generate.html' };
    }
  }
  res.status(resCode);
  res.json(result);
}

const SAMPLE_JSON = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: {
        textAlign: 'left',
      },
      content: [
        {
          type: 'text',
          text: 'Le lorem ipsum est, en imprimerie, une suite de mots sans signification utilisée à titre provisoire pour calibrer une mise en page',
        },
      ],
    },
  ],
};

const SAMPLE_HTML = '<div>Hello world</div>';
