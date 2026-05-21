// Define regex patterns
const volume_list = '1|2|3|I|II|III|1st|2nd|3rd|First|Second|Third';

const book_list = 'Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther' +
    '|Job|Psalms?|Proverbs?|Ecclesiastes|Songs? of Solomon|Song of Songs|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi' +
    '|Wisdom|Maccabees' +
    '|Matthew|Mark|Luke|John|Acts?|Acts of the Apostles|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation(?:s?)?';

const abbrev_list = 'Gen|Ex|Exo|Lev|Num|Nmb|Deut?|Dt|Josh?|Judg?|Jdg|Rut|Sam|Ki|Kin|Kn|Kgs|Chr(?:on?)?|Ezr|Neh|Est' +
    '|Jb|Psa?|Pr(?:ov?)?|Eccl?|Song?|Isa|Is|Jer|Lam|Eze|Da?n|Hos|Joe|Amo?|Oba|Jon|Mic|Nah|Hab|Zeph?|Hag|Zech?|Mal' +
    '|Wis|Sir|Mac|Macc|Jud|Tob' +
    '|M(?:at)?t|Mr?k|Lu?k|Jh?n|Jo|Act|Rom|Cor|Gal|Eph|Col|Phi(?:l?)?|The?|Thess?|Ti?m|Tit|Phile|Heb|Ja?m|Pe?t|Pt|Ju|Rev';

const book_regex = `(?:${book_list}|${abbrev_list})\\.?`;

const verse_substr_regex = '(?:[:.][0-9]{1,3})?(?:[-&,;]\\s?[0-9]{1,3}(?!\\s?' + book_regex + '))*';

const verse_regex = '[0-9]{1,3}(?:' + verse_substr_regex + ')+';

const passage_regex = new RegExp(`\\b(?:(?<!\\.)(${volume_list})\\s?)?(${book_regex})\\s(${verse_regex})`, 'gi');

let lastBook = null;
let lastChapter = null;

// Create a map of abbreviations to full book names
const bookAbbreviations = {
    'Gen': 'Genesis',
    'Gen.': 'Genesis',
    'Ex': 'Exodus',
    'Ex.': 'Exodus',
    'Exo': 'Exodus',
    'Exo.': 'Exodus',
    'Lev': 'Leviticus',
    'Lev.': 'Leviticus',
    'Num': 'Numbers',
    'Num.': 'Numbers',
    'Nmb': 'Numbers',
    'Nmb.': 'Numbers',
    'Deut': 'Deuteronomy',
    'Deut.': 'Deuteronomy',
    'Dt': 'Deuteronomy',
    'Dt.': 'Deuteronomy',
    'Josh': 'Joshua',
    'Josh.': 'Joshua',
    'Judg': 'Judges',
    'Judg.': 'Judges',
    'Jdg': 'Judges',
    'Jdg.': 'Judges',
    'Rut': 'Ruth',
    'Rut.': 'Ruth',
    'Sam': 'Samuel',
    'Sam.': 'Samuel',
    'Ki': 'Kings',
    'Ki.': 'Kings',
    'Kgs': 'Kings',
    'Kgs.': 'Kings',
    'Kin': 'Kings',
    'Kin.': 'Kings',
    'Kn': 'Kings',
    'Kn.': 'Kings',
    'Chr': 'Chronicles',
    'Chr.': 'Chronicles',
    'Chron': 'Chronicles',
    'Chron.': 'Chronicles',
    'Ezr': 'Ezra',
    'Ezr.': 'Ezra',
    'Neh': 'Nehemiah',
    'Neh.': 'Nehemiah',
    'Est': 'Esther',
    'Est.': 'Esther',
    'Jb': 'Job',
    'Jb.': 'Job',
    'Psa': 'Psalm',
    'Psa.': 'Psalm',
    'Ps': 'Psalm',
    'Ps.': 'Psalm',
    'Psalms': 'Psalm',
    'Psalms.': 'Psalm',
    'Pr': 'Proverbs',
    'Pr.': 'Proverbs',
    'Prov': 'Proverbs',
    'Prov.': 'Proverbs',
    'Eccl': 'Ecclesiastes',
    'Eccl.': 'Ecclesiastes',
    'Song': 'Song of Solomon',
    'Song.': 'Song of Solomon',
    'Isa': 'Isaiah',
    'Isa.': 'Isaiah',
    'Is': 'Isaiah',
    'Is.': 'Isaiah',
    'Jer': 'Jeremiah',
    'Jer.': 'Jeremiah',
    'Lam': 'Lamentations',
    'Lam.': 'Lamentations',
    'Eze': 'Ezekiel',
    'Eze.': 'Ezekiel',
    'Dan': 'Daniel',
    'Dan.': 'Daniel',
    'Hos': 'Hosea',
    'Hos.': 'Hosea',
    'Joe': 'Joel',
    'Joe.': 'Joel',
    'Amo': 'Amos',
    'Amo.': 'Amos',
    'Oba': 'Obadiah',
    'Oba.': 'Obadiah',
    'Jon': 'Jonah',
    'Jon.': 'Jonah',
    'Mic': 'Micah',
    'Mic.': 'Micah',
    'Nah': 'Nahum',
    'Nah.': 'Nahum',
    'Hab': 'Habakkuk',
    'Hab.': 'Habakkuk',
    'Zeph': 'Zephaniah',
    'Zeph.': 'Zephaniah',
    'Hag': 'Haggai',
    'Hag.': 'Haggai',
    'Zech': 'Zechariah',
    'Zech.': 'Zechariah',
    'Mal': 'Malachi',
    'Mal.': 'Malachi',
    'Wis': 'Wisdom',
    'Wis.': 'Wisdom',
    'Sir': 'Sirach',
    'Sir.': 'Sirach',
    'Macc': 'Maccabees',
    'Macc.': 'Maccabees',
    'Mac': 'Maccabees',
    'Mac.': 'Maccabees',
    'Jud': 'Judith',
    'Jud.': 'Judith',
    'Tob': 'Tobit',
    'Tob.': 'Tobit',
    'Matt': 'Matthew',
    'Matt.': 'Matthew',
    'Mt': 'Matthew',
    'Mt.': 'Matthew',
    'Mk': 'Mark',
    'Mk.': 'Mark',
    'Mrk': 'Mark',
    'Mrk.': 'Mark',
    'Lu': 'Luke',
    'Lu.': 'Luke',
    'Lk': 'Luke',
    'Lk.': 'Luke',
    'Jh': 'John',
    'Jh.': 'John',
    'Jn': 'John',
    'Jn.': 'John',
    'Jo': 'John',
    'Jo.': 'John',
    'Act': 'Acts',
    'Act.': 'Acts',
    'Rom': 'Romans',
    'Rom.': 'Romans',
    'Cor': 'Corinthians',
    'Cor.': 'Corinthians',
    'Gal': 'Galatians',
    'Gal.': 'Galatians',
    'Eph': 'Ephesians',
    'Eph.': 'Ephesians',
    'Col': 'Colossians',
    'Col.': 'Colossians',
    'Phi': 'Philippians',
    'Phi.': 'Philippians',
    'Phil': 'Philippians',
    'Phil.': 'Philippians',
    'Thes': 'Thessalonians',
    'Thes.': 'Thessalonians',
    'Thess': 'Thessalonians',
    'Thess': 'Thessalonians',
    'Tim': 'Timothy',
    'Tim.': 'Timothy',
    'Ti': 'Timothy',
    'Ti.': 'Timothy',
    'Tit': 'Titus',
    'Tit.': 'Titus',
    'Phile': 'Philemon',
    'Phile.': 'Philemon',
    'Heb': 'Hebrews',
    'Heb.': 'Hebrews',
    'Jam': 'James',
    'Jam.': 'James',
    'Jas': 'James',
    'Jas.': 'James',
    'Pet': 'Peter',
    'Pet.': 'Peter',
    'Pe': 'Peter',
    'Pe.': 'Peter',
    'Pt': 'Peter',
    'Pt.': 'Peter',
    'Ju': 'Jude',
    'Ju.': 'Jude',
    'Rev': 'Revelation',
    'Rev.': 'Revelation',
    'Revelations': 'Revelation',
    'Revelations.': 'Revelation'
};

function getScriptureLink(reference) {
    reference = reference.replace(":", ".");
    reference = encodeURIComponent(reference);
    return `https://www.biblegateway.com/passage/?search=${reference}&version=RSVCE&interface=print`;
}

function toTitleCase(str) {
    const excludedWords = ['of', 'and'];

    return str.toLowerCase().replace(/\b\w+/g, function(word, index) {
        // Check if it's the first word or not in the excluded list
        if (index === 0 || !excludedWords.includes(word)) {
            return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
    });
}

function formatReference(reference) {
    const scriptureLink = getScriptureLink(reference);
    const referenceInTC = toTitleCase(reference);
    return `[${referenceInTC}](${scriptureLink})`;
}

function extractReferences(text) {
    const references = [];
    let match;

    while ((match = passage_regex.exec(text)) !== null) {
        const volume = match[1] || '';
        let book = match[2];
        const verse = match[3];

        if (bookAbbreviations.hasOwnProperty(book)) {
            book = bookAbbreviations[book];
        } else {
            const bookRegexMatch = new RegExp(book_list, 'i').exec(book);
            book = bookRegexMatch ? bookRegexMatch[0] : book;
        }

        let reference;

        lastBook = volume ? `${volume} ${book}` : book;

        const ranges = verse.split('-');
        const reversedRanges = [...ranges].reverse();
        let lastRange = null;

        for (const range of reversedRanges) {
            if (range.includes(':')) {
                lastRange = range;
                break;
            } else {
                lastRange = range;
            }
        }

        const chaptersplit = lastRange ? lastRange.split(':') : [];
        lastChapter = chaptersplit[0] || null;

        reference = `${lastBook} ${verse}`;

        reference = reference.trim();

        references.push(formatReference(reference));
    }

    return references;
}

let outputList = '\n';
let justReferences = extractReferences(text);
justReferences.forEach(referenceNewLine);

function referenceNewLine(item) {
    outputList += item +'\n\n';
}

return outputList;