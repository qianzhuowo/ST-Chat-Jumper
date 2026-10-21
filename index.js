/* ST Chat Jumper — native ESM bootstrap. See docs/modules.md for extension points. */
import { messageFormatting as coreMessageFormatting, messageEdit } from '../../../../script.js';
import { SWIPE_DIRECTION } from '../../../constants.js';
import { createApplication } from './src/application.js';

createApplication({ coreMessageFormatting, messageEdit, SWIPE_DIRECTION }).start();
