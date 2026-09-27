// Lightweight EN / Gujarati dictionary for the console's highest-visibility
// strings (nav, headings, key stat labels, key buttons). Not a full i18n
// system — scoped to what a viewer sees in the first screen of the demo.
import { useEffect, useState } from 'react'

export type Lang = 'en' | 'gu'

export const dict = {
  nav_overview: { en: 'Overview', gu: 'ઝાંખી' },
  nav_cameras: { en: 'Cameras', gu: 'કેમેરા' },
  nav_search: { en: 'Plate search', gu: 'નંબર પ્લેટ શોધ' },
  nav_watchlist: { en: 'Watchlist', gu: 'વોચલિસ્ટ' },
  nav_reports: { en: 'Reports', gu: 'અહેવાલો' },
  nav_audit: { en: 'Audit trail', gu: 'ઓડિટ ટ્રેલ' },
  brand_tagline: { en: 'Ahmedabad · Gujarat', gu: 'અમદાવાદ · ગુજરાત' },
  system_ready: { en: 'SYSTEM READY', gu: 'સિસ્ટમ તૈયાર' },
  breadcrumb_ops: { en: 'OPERATIONS', gu: 'સંચાલન' },

  overview_eyebrow: { en: 'STATE OPERATIONS / NETWORK PICTURE', gu: 'રાજ્ય સંચાલન / નેટવર્ક ચિત્ર' },
  overview_title: { en: 'Operations overview', gu: 'સંચાલન ઝાંખી' },
  overview_sub: { en: 'Camera activity, watchlist alerts and cross-camera movement in one place.', gu: 'કેમેરા પ્રવૃત્તિ, વોચલિસ્ટ ચેતવણીઓ અને ક્રોસ-કેમેરા હિલચાલ એક જ જગ્યાએ.' },
  run_scenario: { en: 'Run synthetic scenario', gu: 'સિન્થેટિક દૃશ્ય ચલાવો' },
  add_camera: { en: 'Add camera', gu: 'કેમેરા ઉમેરો' },

  stat_cameras: { en: 'REGISTERED CAMERAS', gu: 'નોંધાયેલા કેમેરા' },
  stat_tracks: { en: 'VEHICLE TRACKS', gu: 'વાહન ટ્રેક' },
  stat_alerts: { en: 'WATCHLIST ALERTS', gu: 'વોચલિસ્ટ ચેતવણીઓ' },
  stat_review: { en: 'NEEDS REVIEW', gu: 'સમીક્ષા જરૂરી' },

  camera_wall_eyebrow: { en: 'VISIBLE SOURCES', gu: 'દૃશ્યમાન સ્ત્રોત' },
  camera_wall_title: { en: 'Camera wall', gu: 'કેમેરા દિવાલ' },

  net3d_title: { en: 'Camera network', gu: 'કેમેરા નેટવર્ક' },
  net_3d_mesh: { en: '3D mesh', gu: '3D મેશ' },
  net_gujarat_map: { en: 'Gujarat map', gu: 'ગુજરાત નકશો' },

  decision_queue_eyebrow: { en: 'DECISION QUEUE', gu: 'નિર્ણય કતાર' },
  recent_alerts: { en: 'Recent alerts', gu: 'તાજેતરની ચેતવણીઓ' },

  cameras_eyebrow: { en: 'CAMERA PASSPORT', gu: 'કેમેરા પાસપોર્ટ' },
  cameras_title: { en: 'Camera network', gu: 'કેમેરા નેટવર્ક' },
  cameras_sub: { en: 'Register RTSP, HLS or recorded footage. Stream properties are probed during onboarding.', gu: 'RTSP, HLS અથવા રેકોર્ડ કરેલ ફૂટેજ નોંધો. ઓનબોર્ડિંગ દરમિયાન સ્ટ્રીમ ગુણધર્મો ચકાસવામાં આવે છે.' },
  no_cameras_title: { en: 'No cameras', gu: 'કોઈ કેમેરા નથી' },

  search_eyebrow: { en: 'CROSS-CAMERA INVESTIGATION', gu: 'ક્રોસ-કેમેરા તપાસ' },
  search_title: { en: 'Plate search', gu: 'નંબર પ્લેટ શોધ' },
  search_sub: { en: 'Trace recorded sightings across registered locations.', gu: 'નોંધાયેલા સ્થળોમાં નોંધાયેલ દર્શન શોધો.' },
  search_placeholder: { en: 'Enter registration number, e.g. GJ01AB1234', gu: 'નોંધણી નંબર દાખલ કરો, દા.ત. GJ01AB1234' },
  search_button: { en: 'Search sightings', gu: 'દર્શન શોધો' },
  start_with_plate: { en: 'Start with a plate', gu: 'પ્લેટથી શરૂ કરો' },

  watchlist_eyebrow: { en: 'AUTHORISED CORRELATION', gu: 'અધિકૃત સહસંબંધ' },
  watchlist_title: { en: 'Watchlist', gu: 'વોચલિસ્ટ' },
  watchlist_sub: { en: 'Entries carry a category, source authority and expiry. Face entries need two approvers.', gu: 'એન્ટ્રીઓમાં શ્રેણી, સ્ત્રોત સત્તા અને સમાપ્તિ હોય છે. ચહેરાની એન્ટ્રીઓ માટે બે મંજૂરી આપનાર જરૂરી છે.' },
  add_plate: { en: 'Add plate', gu: 'પ્લેટ ઉમેરો' },
  enroll_face: { en: 'Enroll face', gu: 'ચહેરો નોંધો' },

  reports_eyebrow: { en: 'EVIDENCE EXPORT', gu: 'પુરાવા નિકાસ' },
  reports_title: { en: 'Vehicle report', gu: 'વાહન અહેવાલ' },
  reports_sub: { en: 'One row per processed vehicle track, including low confidence and unreadable results.', gu: 'દરેક પ્રોસેસ કરેલ વાહન ટ્રેક માટે એક પંક્તિ, ઓછા વિશ્વાસ અને અવાચ્ય પરિણામો સહિત.' },
  export_csv: { en: 'Export CSV', gu: 'CSV નિકાસ કરો' },
  export_pdf: { en: 'Export PDF', gu: 'PDF નિકાસ કરો' },

  audit_eyebrow: { en: 'CHAIN OF CUSTODY', gu: 'કસ્ટડી શ્રુંખલા' },
  audit_title: { en: 'Audit trail', gu: 'ઓડિટ ટ્રેલ' },
  audit_sub: { en: 'Every material action is linked to the previous record with SHA-256.', gu: 'દરેક મહત્વપૂર્ણ ક્રિયા SHA-256 સાથે અગાઉના રેકોર્ડ સાથે જોડાયેલ છે.' },
  verify_chain: { en: 'Verify chain', gu: 'શ્રુંખલા ચકાસો' },

  sign_out: { en: 'sign out', gu: 'સાઇન આઉટ' },
} as const

export type DictKey = keyof typeof dict

export function useLang(): [Lang, () => void, (key: DictKey) => string] {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('sentinel_lang') as Lang) || 'en')
  useEffect(() => { localStorage.setItem('sentinel_lang', lang) }, [lang])
  const t = (key: DictKey) => dict[key][lang]
  return [lang, () => setLang(l => (l === 'en' ? 'gu' : 'en')), t]
}
