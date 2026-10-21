/**
 * What the Telegram bot says, in the eight app languages.
 *
 *   TELEGRAM_MESSAGES                  the catalogue, one block per locale
 *   telegramText(locale, key, params)  one message, English when a key is missing
 *   telegramLocale(value)              any client value -> one of the eight, or English
 *
 * Who decides the language (telegram-alerts.ts, routes/telegram.ts):
 *   - The SOS alert: the USER's app language, sent by the app at confirm time
 *     (`lang` in POST /v1/sos/:id/confirm), else the language stored on the
 *     account (set by `LANG HI` over SMS), else English.
 *   - The bot's replies (/start confirmation, /stop, /help, a bad link): the
 *     language the invite was made in (telegram_link_codes.lang, copied to the
 *     contact when it links), else English.
 *
 * Structure is the same in every language and pinned by telegram.test.ts:
 * who (first name only), the reference, the time in IST, the two map links
 * (built by domain/telegram.ts, never translated), the "automated demo alert,
 * call 112" disclaimer and the /stop hint. The command "/stop" and the number
 * 112 stay as written in every language: they are what the reader must type
 * or dial.
 *
 * Telegram is not SMS, so there is no segment budget here (unlike i18n.ts).
 *
 * Seven of the eight are machine-translated and NOT native-reviewed
 * (docs/translations/README.md); review-telegram.csv lists them for review.
 * A missing translation falls back to English per message, never to a key.
 */
import { LOCALES, isLocale, type Locale } from "../i18n.js";

export type TelegramKey =
  | "alert.headline" | "alert.someone" | "alert.ref" | "alert.time" | "alert.location"
  | "alert.osm" | "alert.noLocation" | "alert.disclaimer" | "alert.stopHint"
  | "linked" | "linked.someone"
  | "stopped" | "stoppedNothing" | "badCode" | "noCode" | "help" | "notPrivate";

export const TELEGRAM_MESSAGES: Record<Locale, Partial<Record<TelegramKey, string>>> = {
  en: {
    "alert.headline": "SOS: {who} has raised an emergency on RoadAssist.",
    "alert.someone": "A RoadAssist user who listed you as an emergency contact",
    "alert.ref": "Ref: {ref}",
    "alert.time": "Time: {time}",
    "alert.location": "Location: {url}",
    "alert.osm": "OpenStreetMap: {url}",
    "alert.noLocation": "Location: not known (the phone had no GPS fix).",
    "alert.disclaimer": "This is an automated RoadAssist demo alert; call 112 in an emergency.",
    "alert.stopHint": "Send /stop to stop these alerts.",
    "linked": "You are now an emergency contact for {name}. You will get a message here if they raise an SOS.\n\nSend /stop at any time to stop these messages.",
    "linked.someone": "a RoadAssist user",
    "stopped": "Unlinked. You will no longer get RoadAssist SOS alerts in this chat.",
    "stoppedNothing": "This chat is not linked to anyone on RoadAssist, so there is nothing to stop.",
    "badCode": "This invite link has expired or was already used. Ask the person who sent it for a new one.",
    "noCode": "To become someone's emergency contact, open the invite link they sent you.",
    "help": "RoadAssist sends an SOS alert here for each person whose invite link you opened. Send /stop to stop all of them.",
    "notPrivate": "Emergency alerts can only go to a private chat. Open the invite link in a one-to-one chat with this bot.",
  },
  hi: {
    // Machine-translated, NOT native-reviewed (docs/translations/README.md).
    "alert.headline": "SOS: {who} ने RoadAssist पर आपातकालीन मदद माँगी है।",
    "alert.someone": "आपको आपातकालीन संपर्क बनाने वाले एक RoadAssist उपयोगकर्ता",
    "alert.ref": "संदर्भ: {ref}",
    "alert.time": "समय: {time}",
    "alert.location": "लोकेशन: {url}",
    "alert.osm": "OpenStreetMap: {url}",
    "alert.noLocation": "लोकेशन: पता नहीं (फ़ोन को GPS नहीं मिला)।",
    "alert.disclaimer": "यह RoadAssist का स्वचालित डेमो अलर्ट है; आपात स्थिति में 112 पर कॉल करें।",
    "alert.stopHint": "ये अलर्ट बंद करने के लिए /stop भेजें।",
    "linked": "अब आप {name} के आपातकालीन संपर्क हैं। अगर वे SOS भेजते हैं तो आपको यहाँ संदेश मिलेगा।\n\nये संदेश कभी भी बंद करने के लिए /stop भेजें।",
    "linked.someone": "एक RoadAssist उपयोगकर्ता",
    "stopped": "लिंक हटा दिया गया। अब इस चैट में RoadAssist SOS अलर्ट नहीं आएँगे।",
    "stoppedNothing": "यह चैट RoadAssist पर किसी से जुड़ी नहीं है, इसलिए बंद करने को कुछ नहीं है।",
    "badCode": "यह आमंत्रण लिंक समाप्त हो गया है या पहले ही इस्तेमाल हो चुका है। भेजने वाले से नया लिंक माँगें।",
    "noCode": "किसी के आपातकालीन संपर्क बनने के लिए उनका भेजा आमंत्रण लिंक खोलें।",
    "help": "जिन लोगों का आमंत्रण लिंक आपने खोला है, उनके हर SOS का अलर्ट RoadAssist यहाँ भेजता है। सभी बंद करने के लिए /stop भेजें।",
    "notPrivate": "आपातकालीन अलर्ट केवल निजी चैट में जा सकते हैं। आमंत्रण लिंक इस बॉट के साथ एक-से-एक चैट में खोलें।",
  },
  ta: {
    // Machine-translated, NOT native-reviewed (docs/translations/README.md).
    "alert.headline": "SOS: {who} RoadAssist-இல் அவசர உதவி கோரியுள்ளார்.",
    "alert.someone": "உங்களை அவசரத் தொடர்பாகச் சேர்த்த ஒரு RoadAssist பயனர்",
    "alert.ref": "குறிப்பு: {ref}",
    "alert.time": "நேரம்: {time}",
    "alert.location": "இடம்: {url}",
    "alert.osm": "OpenStreetMap: {url}",
    "alert.noLocation": "இடம்: தெரியவில்லை (ஃபோனுக்கு GPS கிடைக்கவில்லை).",
    "alert.disclaimer": "இது RoadAssist-இன் தானியங்கி டெமோ எச்சரிக்கை; அவசரத்தில் 112-ஐ அழைக்கவும்.",
    "alert.stopHint": "இந்த எச்சரிக்கைகளை நிறுத்த /stop அனுப்பவும்.",
    "linked": "நீங்கள் இப்போது {name}-இன் அவசரத் தொடர்பு. அவர் SOS அனுப்பினால் இங்கே செய்தி வரும்.\n\nஇந்தச் செய்திகளை எப்போது வேண்டுமானாலும் நிறுத்த /stop அனுப்பவும்.",
    "linked.someone": "ஒரு RoadAssist பயனர்",
    "stopped": "இணைப்பு நீக்கப்பட்டது. இந்த அரட்டையில் இனி RoadAssist SOS எச்சரிக்கைகள் வராது.",
    "stoppedNothing": "இந்த அரட்டை RoadAssist-இல் யாருடனும் இணைக்கப்படவில்லை, எனவே நிறுத்த எதுவும் இல்லை.",
    "badCode": "இந்த அழைப்பு இணைப்பு காலாவதியானது அல்லது ஏற்கெனவே பயன்படுத்தப்பட்டது. அனுப்பியவரிடம் புதிய இணைப்பைக் கேளுங்கள்.",
    "noCode": "ஒருவரின் அவசரத் தொடர்பாக ஆக, அவர் அனுப்பிய அழைப்பு இணைப்பைத் திறக்கவும்.",
    "help": "நீங்கள் திறந்த அழைப்பு இணைப்புகளுக்குரிய ஒவ்வொருவரின் SOS எச்சரிக்கையையும் RoadAssist இங்கே அனுப்பும். அனைத்தையும் நிறுத்த /stop அனுப்பவும்.",
    "notPrivate": "அவசர எச்சரிக்கைகள் தனிப்பட்ட அரட்டைக்கு மட்டுமே செல்லும். இந்த பாட்டுடன் தனி அரட்டையில் அழைப்பு இணைப்பைத் திறக்கவும்.",
  },
  te: {
    // Machine-translated, NOT native-reviewed (docs/translations/README.md).
    "alert.headline": "SOS: {who} RoadAssistలో అత్యవసర సహాయం కోరారు.",
    "alert.someone": "మిమ్మల్ని అత్యవసర పరిచయంగా చేర్చిన ఒక RoadAssist వినియోగదారు",
    "alert.ref": "రెఫ్: {ref}",
    "alert.time": "సమయం: {time}",
    "alert.location": "లొకేషన్: {url}",
    "alert.osm": "OpenStreetMap: {url}",
    "alert.noLocation": "లొకేషన్: తెలియదు (ఫోన్‌కు GPS దొరకలేదు).",
    "alert.disclaimer": "ఇది RoadAssist ఆటోమేటిక్ డెమో హెచ్చరిక; అత్యవసరంలో 112కు కాల్ చేయండి.",
    "alert.stopHint": "ఈ హెచ్చరికలను ఆపడానికి /stop పంపండి.",
    "linked": "మీరు ఇప్పుడు {name}కి అత్యవసర పరిచయం. వారు SOS పంపితే మీకు ఇక్కడ సందేశం వస్తుంది.\n\nఈ సందేశాలను ఎప్పుడైనా ఆపడానికి /stop పంపండి.",
    "linked.someone": "ఒక RoadAssist వినియోగదారు",
    "stopped": "లింక్ తీసివేయబడింది. ఈ చాట్‌లో ఇకపై RoadAssist SOS హెచ్చరికలు రావు.",
    "stoppedNothing": "ఈ చాట్ RoadAssistలో ఎవరికీ లింక్ కాలేదు, కాబట్టి ఆపడానికి ఏమీ లేదు.",
    "badCode": "ఈ ఆహ్వాన లింక్ గడువు ముగిసింది లేదా ఇప్పటికే వాడబడింది. పంపినవారిని కొత్త లింక్ అడగండి.",
    "noCode": "ఎవరికైనా అత్యవసర పరిచయం కావడానికి, వారు పంపిన ఆహ్వాన లింక్‌ను తెరవండి.",
    "help": "మీరు తెరిచిన ఆహ్వాన లింక్‌లలోని ప్రతి వ్యక్తి SOS హెచ్చరికను RoadAssist ఇక్కడ పంపుతుంది. అన్నింటినీ ఆపడానికి /stop పంపండి.",
    "notPrivate": "అత్యవసర హెచ్చరికలు ప్రైవేట్ చాట్‌కు మాత్రమే వెళ్తాయి. ఈ బాట్‌తో వ్యక్తిగత చాట్‌లో ఆహ్వాన లింక్‌ను తెరవండి.",
  },
  bn: {
    // Machine-translated, NOT native-reviewed (docs/translations/README.md).
    "alert.headline": "SOS: {who} RoadAssist-এ জরুরি সাহায্য চেয়েছেন।",
    "alert.someone": "আপনাকে জরুরি পরিচিতি হিসেবে রাখা একজন RoadAssist ব্যবহারকারী",
    "alert.ref": "রেফ: {ref}",
    "alert.time": "সময়: {time}",
    "alert.location": "লোকেশন: {url}",
    "alert.osm": "OpenStreetMap: {url}",
    "alert.noLocation": "লোকেশন: জানা নেই (ফোনে GPS পাওয়া যায়নি)।",
    "alert.disclaimer": "এটি RoadAssist-এর স্বয়ংক্রিয় ডেমো সতর্কতা; জরুরি অবস্থায় 112-এ কল করুন।",
    "alert.stopHint": "এই সতর্কতা বন্ধ করতে /stop পাঠান।",
    "linked": "আপনি এখন {name}-এর জরুরি পরিচিতি। তিনি SOS পাঠালে আপনি এখানে বার্তা পাবেন।\n\nযেকোনো সময় এই বার্তা বন্ধ করতে /stop পাঠান।",
    "linked.someone": "একজন RoadAssist ব্যবহারকারী",
    "stopped": "লিংক সরানো হয়েছে। এই চ্যাটে আর RoadAssist SOS সতর্কতা আসবে না।",
    "stoppedNothing": "এই চ্যাট RoadAssist-এ কারও সঙ্গে যুক্ত নয়, তাই বন্ধ করার কিছু নেই।",
    "badCode": "এই আমন্ত্রণ লিংকের মেয়াদ শেষ বা আগেই ব্যবহার হয়েছে। যিনি পাঠিয়েছেন তাঁর কাছে নতুন লিংক চান।",
    "noCode": "কারও জরুরি পরিচিতি হতে, তাঁর পাঠানো আমন্ত্রণ লিংক খুলুন।",
    "help": "আপনি যাঁদের আমন্ত্রণ লিংক খুলেছেন, তাঁদের প্রত্যেকের SOS সতর্কতা RoadAssist এখানে পাঠায়। সব বন্ধ করতে /stop পাঠান।",
    "notPrivate": "জরুরি সতর্কতা শুধু ব্যক্তিগত চ্যাটে যায়। এই বটের সঙ্গে একান্ত চ্যাটে আমন্ত্রণ লিংক খুলুন।",
  },
  mr: {
    // Machine-translated, NOT native-reviewed (docs/translations/README.md).
    "alert.headline": "SOS: {who} यांनी RoadAssist वर आणीबाणीची मदत मागितली आहे.",
    "alert.someone": "तुम्हाला आणीबाणी संपर्क म्हणून जोडलेले एक RoadAssist वापरकर्ते",
    "alert.ref": "संदर्भ: {ref}",
    "alert.time": "वेळ: {time}",
    "alert.location": "लोकेशन: {url}",
    "alert.osm": "OpenStreetMap: {url}",
    "alert.noLocation": "लोकेशन: माहीत नाही (फोनला GPS मिळाला नाही).",
    "alert.disclaimer": "हा RoadAssist चा स्वयंचलित डेमो अलर्ट आहे; आणीबाणीत 112 वर कॉल करा.",
    "alert.stopHint": "हे अलर्ट थांबवण्यासाठी /stop पाठवा.",
    "linked": "तुम्ही आता {name} यांचे आणीबाणी संपर्क आहात. त्यांनी SOS पाठवल्यास तुम्हाला इथे संदेश येईल.\n\nहे संदेश कधीही थांबवण्यासाठी /stop पाठवा.",
    "linked.someone": "एक RoadAssist वापरकर्ते",
    "stopped": "लिंक काढली. या चॅटमध्ये आता RoadAssist SOS अलर्ट येणार नाहीत.",
    "stoppedNothing": "ही चॅट RoadAssist वर कोणाशीही जोडलेली नाही, त्यामुळे थांबवण्यासारखे काही नाही.",
    "badCode": "ही आमंत्रण लिंक संपली आहे किंवा आधीच वापरली गेली आहे. पाठवणाऱ्याकडे नवी लिंक मागा.",
    "noCode": "कोणाचे आणीबाणी संपर्क होण्यासाठी, त्यांनी पाठवलेली आमंत्रण लिंक उघडा.",
    "help": "तुम्ही ज्यांच्या आमंत्रण लिंक उघडल्या, त्या प्रत्येकाचा SOS अलर्ट RoadAssist इथे पाठवते. सर्व थांबवण्यासाठी /stop पाठवा.",
    "notPrivate": "आणीबाणी अलर्ट फक्त खाजगी चॅटमध्ये जातात. या बॉटसोबतच्या वैयक्तिक चॅटमध्ये आमंत्रण लिंक उघडा.",
  },
  kn: {
    // Machine-translated, NOT native-reviewed (docs/translations/README.md).
    "alert.headline": "SOS: {who} RoadAssist ನಲ್ಲಿ ತುರ್ತು ಸಹಾಯ ಕೇಳಿದ್ದಾರೆ.",
    "alert.someone": "ನಿಮ್ಮನ್ನು ತುರ್ತು ಸಂಪರ್ಕವಾಗಿ ಸೇರಿಸಿದ ಒಬ್ಬ RoadAssist ಬಳಕೆದಾರರು",
    "alert.ref": "ಉಲ್ಲೇಖ: {ref}",
    "alert.time": "ಸಮಯ: {time}",
    "alert.location": "ಸ್ಥಳ: {url}",
    "alert.osm": "OpenStreetMap: {url}",
    "alert.noLocation": "ಸ್ಥಳ: ತಿಳಿದಿಲ್ಲ (ಫೋನಿಗೆ GPS ಸಿಗಲಿಲ್ಲ).",
    "alert.disclaimer": "ಇದು RoadAssist ನ ಸ್ವಯಂಚಾಲಿತ ಡೆಮೊ ಎಚ್ಚರಿಕೆ; ತುರ್ತು ಸಂದರ್ಭದಲ್ಲಿ 112 ಗೆ ಕರೆ ಮಾಡಿ.",
    "alert.stopHint": "ಈ ಎಚ್ಚರಿಕೆಗಳನ್ನು ನಿಲ್ಲಿಸಲು /stop ಕಳಿಸಿ.",
    "linked": "ನೀವು ಈಗ {name} ಅವರ ತುರ್ತು ಸಂಪರ್ಕ. ಅವರು SOS ಕಳಿಸಿದರೆ ನಿಮಗೆ ಇಲ್ಲಿ ಸಂದೇಶ ಬರುತ್ತದೆ.\n\nಈ ಸಂದೇಶಗಳನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ ನಿಲ್ಲಿಸಲು /stop ಕಳಿಸಿ.",
    "linked.someone": "ಒಬ್ಬ RoadAssist ಬಳಕೆದಾರರು",
    "stopped": "ಲಿಂಕ್ ತೆಗೆದುಹಾಕಲಾಗಿದೆ. ಈ ಚಾಟ್‌ನಲ್ಲಿ ಇನ್ನು RoadAssist SOS ಎಚ್ಚರಿಕೆಗಳು ಬರುವುದಿಲ್ಲ.",
    "stoppedNothing": "ಈ ಚಾಟ್ RoadAssist ನಲ್ಲಿ ಯಾರಿಗೂ ಲಿಂಕ್ ಆಗಿಲ್ಲ, ಆದ್ದರಿಂದ ನಿಲ್ಲಿಸಲು ಏನೂ ಇಲ್ಲ.",
    "badCode": "ಈ ಆಹ್ವಾನ ಲಿಂಕ್‌ನ ಅವಧಿ ಮುಗಿದಿದೆ ಅಥವಾ ಈಗಾಗಲೇ ಬಳಸಲಾಗಿದೆ. ಕಳಿಸಿದವರಿಂದ ಹೊಸ ಲಿಂಕ್ ಕೇಳಿ.",
    "noCode": "ಯಾರಿಗಾದರೂ ತುರ್ತು ಸಂಪರ್ಕವಾಗಲು, ಅವರು ಕಳಿಸಿದ ಆಹ್ವಾನ ಲಿಂಕ್ ತೆರೆಯಿರಿ.",
    "help": "ನೀವು ತೆರೆದ ಆಹ್ವಾನ ಲಿಂಕ್‌ಗಳ ಪ್ರತಿಯೊಬ್ಬರ SOS ಎಚ್ಚರಿಕೆಯನ್ನು RoadAssist ಇಲ್ಲಿ ಕಳಿಸುತ್ತದೆ. ಎಲ್ಲವನ್ನೂ ನಿಲ್ಲಿಸಲು /stop ಕಳಿಸಿ.",
    "notPrivate": "ತುರ್ತು ಎಚ್ಚರಿಕೆಗಳು ಖಾಸಗಿ ಚಾಟ್‌ಗೆ ಮಾತ್ರ ಹೋಗುತ್ತವೆ. ಈ ಬಾಟ್ ಜೊತೆಗಿನ ವೈಯಕ್ತಿಕ ಚಾಟ್‌ನಲ್ಲಿ ಆಹ್ವಾನ ಲಿಂಕ್ ತೆರೆಯಿರಿ.",
  },
  gu: {
    // Machine-translated, NOT native-reviewed (docs/translations/README.md).
    "alert.headline": "SOS: {who} એ RoadAssist પર કટોકટીની મદદ માગી છે.",
    "alert.someone": "તમને કટોકટી સંપર્ક તરીકે ઉમેરનાર એક RoadAssist વપરાશકર્તા",
    "alert.ref": "સંદર્ભ: {ref}",
    "alert.time": "સમય: {time}",
    "alert.location": "લોકેશન: {url}",
    "alert.osm": "OpenStreetMap: {url}",
    "alert.noLocation": "લોકેશન: ખબર નથી (ફોનને GPS મળ્યું નહીં).",
    "alert.disclaimer": "આ RoadAssist નો સ્વયંસંચાલિત ડેમો એલર્ટ છે; કટોકટીમાં 112 પર કૉલ કરો.",
    "alert.stopHint": "આ એલર્ટ બંધ કરવા /stop મોકલો.",
    "linked": "તમે હવે {name} ના કટોકટી સંપર્ક છો. તેઓ SOS મોકલે તો તમને અહીં સંદેશ મળશે.\n\nઆ સંદેશા ક્યારેય પણ બંધ કરવા /stop મોકલો.",
    "linked.someone": "એક RoadAssist વપરાશકર્તા",
    "stopped": "લિંક દૂર કરી. આ ચેટમાં હવે RoadAssist SOS એલર્ટ નહીં આવે.",
    "stoppedNothing": "આ ચેટ RoadAssist પર કોઈની સાથે જોડાયેલી નથી, તેથી બંધ કરવા જેવું કંઈ નથી.",
    "badCode": "આ આમંત્રણ લિંકની મુદત પૂરી થઈ છે અથવા પહેલેથી વપરાઈ ગઈ છે. મોકલનાર પાસે નવી લિંક માગો.",
    "noCode": "કોઈના કટોકટી સંપર્ક બનવા, તેમણે મોકલેલી આમંત્રણ લિંક ખોલો.",
    "help": "તમે જેમની આમંત્રણ લિંક ખોલી છે, તે દરેકનો SOS એલર્ટ RoadAssist અહીં મોકલે છે. બધું બંધ કરવા /stop મોકલો.",
    "notPrivate": "કટોકટી એલર્ટ ફક્ત ખાનગી ચેટમાં જાય છે. આ બોટ સાથેની વ્યક્તિગત ચેટમાં આમંત્રણ લિંક ખોલો.",
  },
};

/** Every key, from the English block (the complete one). */
export const TELEGRAM_KEYS = Object.keys(TELEGRAM_MESSAGES.en) as TelegramKey[];

/**
 * One of the eight locales for any value a client may send: "hi", "hi-IN",
 * "HI" all mean Hindi; anything else (missing, "fr", a number) is null, and
 * the caller falls back.
 */
export function telegramLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

/**
 * The message for `key` in `locale`, or in English when that locale lacks it
 * (`catalogue` is a parameter only so the fallback can be tested).
 */
export function telegramText(
  locale: Locale | null | undefined,
  key: TelegramKey,
  params: Record<string, string> = {},
  catalogue: Record<string, Partial<Record<TelegramKey, string>>> = TELEGRAM_MESSAGES,
): string {
  const template = (locale ? catalogue[locale]?.[key] : undefined) ?? catalogue.en?.[key] ?? TELEGRAM_MESSAGES.en[key];
  if (template === undefined) throw new Error(`telegram i18n: no message for key "${key}"`);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? params[name] : whole));
}

/** The locales the catalogue covers: the same eight as the app (i18n.ts LOCALES). */
export const TELEGRAM_LOCALES: readonly Locale[] = LOCALES;
