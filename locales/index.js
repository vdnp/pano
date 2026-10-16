import { createI18n, mergeCatalogs } from '../shared/i18n.js';
import tr from './tr.js';
import en from './en.js';

export const appCatalogs = { tr, en };

// Dil bilinmeden atılan hatalar (veritabanı, XML) için: mesaj kaynak dilde (Türkçe),
// anahtar err.i18n'de taşınır; gösteren katman doğru dile çevirir.
export const baseI18n = createI18n({ locale: 'tr', catalogs: mergeCatalogs(appCatalogs) });
