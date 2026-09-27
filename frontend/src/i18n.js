/**
 * Frontend: src/i18n.js — Cấu hình i18n (đa ngôn ngữ)
 *
 * Tổng quan:
 * - Khởi tạo i18next với react-i18next + LanguageDetector
 * - Hỗ trợ 2 ngôn ngữ: vi (tiếng Việt) và en (tiếng Anh)
 * - Tự động phát hiện ngôn ngữ từ localStorage → navigator
 * - Fallback về 'vi' nếu không xác định được
 * - Lưu lựa chọn ngôn ngữ vào localStorage key 'i18n_lang'
 *
 * Exports:
 * - i18n: Instance i18next đã init
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import vi from './locales/vi.json';
import en from './locales/en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      vi: { translation: vi },
      en: { translation: en },
    },
    fallbackLng: 'vi',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18n_lang',
    },
    interpolation: { escapeValue: true },
  });

export default i18n;
