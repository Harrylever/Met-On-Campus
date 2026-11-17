import QRCode from 'qrcode'
import { site } from '~/lib/site'

// Always dark on white with a quiet-zone border, in every theme. Inverted (light-on-dark) codes fail on many scanners,
// so the QR never follows dark mode. Error correction "Q" tolerates a scuffed print or a glare spot.
const options = { errorCorrectionLevel: 'Q' as const, margin: 4, color: { dark: '#141413', light: '#FFFFFF' } }

/** The address people end up at. Clean, with no tracking parameters, so the code stays as simple (and scannable) as possible. */
export const QR_TARGET = site.appUrl

export const qrSvg = () => QRCode.toString(QR_TARGET, { ...options, type: 'svg' })
export const qrPng = (width = 1200) => QRCode.toBuffer(QR_TARGET, { ...options, type: 'png', width })
