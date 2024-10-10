import { Router } from 'express';
import jimp from 'jimp';
import { createRequire } from 'module';
import { AVATAR_HEIGHT, AVATAR_WIDTH } from '../../src/constants.js';
import { invalidateThumbnail } from '../../src/endpoints/thumbnails.js';
import { jsonParser, urlencodedParser } from '../../src/express-common.js';
import { default as fetch } from 'node-fetch';
const require  = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const characterCardParser = require('../../src/character-card-parser.js');
const writeFileAtomicSync = require('write-file-atomic').sync;
const sanitize = require('sanitize-filename');
const { getConfigValue } = require('../../src/util');

const WHITELIST_GENERIC_URL_DOWNLOAD_SOURCES = getConfigValue('whitelistImportDomains', []);


async function replaceAvatar(uploadPath, req, crop = undefined) {
    try {
        const imagePath = path.join(req.user.directories.characters, req.body.avatar_url);
        const charData = characterCardParser.parse(imagePath);

        invalidateThumbnail(req.user.directories, 'avatar', req.body.avatar_url);
        function getInputImage() {
            if (Buffer.isBuffer(uploadPath)) {
                return parseImageBuffer(uploadPath, crop);
            }

            return tryReadImage(uploadPath, crop);
        }

        const inputImage = await getInputImage();
        const outputImage = characterCardParser.write(inputImage, charData);

        await writeFileAtomicSync(imagePath, outputImage);
    } catch (err) {
        console.log(err);
    }
}

/**
 * Downloads a character card from the Pygsite.
 * @param {string} id UUID of the character
 * @returns {Promise<{buffer: Buffer, fileName: string, fileType: string}>}
 */
async function downloadPygmalionCharacter(id) {
    const result = await fetch(`https://server.pygmalion.chat/api/export/character/${id}/v2`);

    if (!result.ok) {
        const text = await result.text();
        console.log('Pygsite returned error', result.status, text);
        throw new Error('Failed to download character');
    }

    const jsonData = await result.json();
    const characterData = jsonData?.character;

    if (!characterData || typeof characterData !== 'object') {
        console.error('Pygsite returned invalid character data', jsonData);
        throw new Error('Failed to download character');
    }

    try {
        const avatarUrl = characterData?.data?.avatar;

        if (!avatarUrl) {
            console.error('Pygsite character does not have an avatar', characterData);
            throw new Error('Failed to download avatar');
        }

        const avatarResult = await fetch(avatarUrl);
        const avatarBuffer = await avatarResult.buffer();

        const cardBuffer = characterCardParser.write(avatarBuffer, JSON.stringify(characterData));

        return {
            buffer: cardBuffer,
            fileName: `${sanitize(id)}.png`,
            fileType: 'image/png',
        };
    } catch (e) {
        console.error('Failed to download avatar, using JSON instead', e);
        return {
            buffer: Buffer.from(JSON.stringify(jsonData)),
            fileName: `${sanitize(id)}.json`,
            fileType: 'application/json',
        };
    }
}

// Warning: Some characters might not exist in JannyAI.me
async function downloadJannyCharacter(uuid) {
    // This endpoint is being guarded behind Bot Fight Mode of Cloudflare
    // So hosted ST on Azure/AWS/GCP/Collab might get blocked by IP
    // Should work normally on self-host PC/Android
    const result = await fetch('https://api.jannyai.com/api/v1/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            'characterId': uuid,
        }),
    });

    if (result.ok) {
        const downloadResult = await result.json();
        if (downloadResult.status === 'ok') {
            const imageResult = await fetch(downloadResult.downloadUrl);
            const buffer = await imageResult.buffer();
            const fileName = `${sanitize(uuid)}.png`;
            const fileType = imageResult.headers.get('content-type');

            return { buffer, fileName, fileType };
        }
    }

    console.log('Janny returned error', result.statusText, await result.text());
    throw new Error('Failed to download character');
}

//Download Character Cards from AICharactersCards.com (AICC) API.
async function downloadAICCCharacter(id) {
    const apiURL = `https://aicharactercards.com/wp-json/pngapi/v1/image/${id}`;
    try {
        const response = await fetch(apiURL);
        if (!response.ok) {
            throw new Error(`Failed to download character: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || 'image/png'; // Default to 'image/png' if header is missing
        const buffer = await response.buffer();
        const fileName = `${sanitize(id)}.png`; // Assuming PNG, but adjust based on actual content or headers

        return {
            buffer: buffer,
            fileName: fileName,
            fileType: contentType,
        };
    } catch (error) {
        console.error('Error downloading character:', error);
        throw error;
    }
}

async function downloadChubCharacter(id) {
    const result = await fetch('https://api.chub.ai/api/characters/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            'format': 'tavern',
            'fullPath': id,
        }),
    });

    if (!result.ok) {
        const text = await result.text();
        console.log('Chub returned error', result.statusText, text);
        throw new Error('Failed to download character');
    }

    const buffer = await result.buffer();
    const fileName = result.headers.get('content-disposition')?.split('filename=')[1] || `${sanitize(id)}.png`;
    const fileType = result.headers.get('content-type');

    return { buffer, fileName, fileType };
}

async function downloadChubLorebook(id) {
    const result = await fetch('https://api.chub.ai/api/lorebooks/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            'fullPath': id,
            'format': 'SILLYTAVERN',
        }),
    });

    if (!result.ok) {
        const text = await result.text();
        console.log('Chub returned error', result.statusText, text);
        throw new Error('Failed to download lorebook');
    }

    const name = id.split('/').pop();
    const buffer = await result.buffer();
    const fileName = `${sanitize(name)}.json`;
    const fileType = result.headers.get('content-type');

    return { buffer, fileName, fileType };
}

/**
 * Download RisuAI character card
 * @param {string} uuid UUID of the character
 * @returns {Promise<{buffer: Buffer, fileName: string, fileType: string}>}
 */
async function downloadRisuCharacter(uuid) {
    const result = await fetch(`https://realm.risuai.net/api/v1/download/png-v3/${uuid}?non_commercial=true`);

    if (!result.ok) {
        const text = await result.text();
        console.log('RisuAI returned error', result.statusText, text);
        throw new Error('Failed to download character');
    }

    const buffer = await result.buffer();
    const fileName = `${sanitize(uuid)}.png`;
    const fileType = 'image/png';

    return { buffer, fileName, fileType };
}

/**
 * Download character card from generic url.
 * @param {String} url
 */
async function downloadGenericPng(url) {
    try {
        const result = await fetch(url);

        if (result.ok) {
            const buffer = await result.buffer();
            const fileName = sanitize(result.url.split('?')[0].split('/').reverse()[0]);
            const contentType = result.headers.get('content-type') || 'image/png'; //yoink it from AICC function lol

            return {
                buffer: buffer,
                fileName: fileName,
                fileType: contentType,
            };
        }
    } catch (error) {
        console.error('Error downloading file: ', error);
        throw error;
    }
    return null;
}

/**
 * Parses an aicharactercards URL to extract the path.
 * @param {string} url URL to parse
 * @returns {string | null} AICC path
 */
function parseAICC(url) {
    const pattern = /^https?:\/\/aicharactercards\.com\/character-cards\/([^/]+)\/([^/]+)\/?$|([^/]+)\/([^/]+)$/;
    const match = url.match(pattern);
    if (match) {
        // Match group 1 & 2 for full URL, 3 & 4 for relative path
        return match[1] && match[2] ? `${match[1]}/${match[2]}` : `${match[3]}/${match[4]}`;
    }
    return null;
}

/**
 *
 * @param {String} str
 * @returns { { id: string, type: "character" | "lorebook" } | null }
 */
function parseChubUrl(str) {
    const splitStr = str.split('/');
    const length = splitStr.length;

    if (length < 2) {
        return null;
    }

    let domainIndex = -1;

    splitStr.forEach((part, index) => {
        if (part === 'www.chub.ai' || part === 'chub.ai' || part === 'www.characterhub.org' || part === 'characterhub.org') {
            domainIndex = index;
        }
    });

    const lastTwo = domainIndex !== -1 ? splitStr.slice(domainIndex + 1) : splitStr;
    const firstPart = lastTwo[0].toLowerCase();

    if (firstPart === 'characters' || firstPart === 'lorebooks') {
        const type = firstPart === 'characters' ? 'character' : 'lorebook';
        const id = type === 'character' ? lastTwo.slice(1).join('/') : lastTwo.join('/');
        return {
            id: id,
            type: type,
        };
    } else if (length === 2) {
        return {
            id: lastTwo.join('/'),
            type: 'character',
        };
    }

    return null;
}

/**
 * Parses an image buffer and applies crop if defined.
 * @param {Buffer} buffer Buffer of the image
 * @param {Crop|undefined} [crop] Crop parameters
 * @returns {Promise<Buffer>} Image buffer
 */
async function parseImageBuffer(buffer, crop) {
    const image = await jimp.read(buffer);
    let finalWidth = image.bitmap.width, finalHeight = image.bitmap.height;

    // Apply crop if defined
    if (typeof crop == 'object' && [crop.x, crop.y, crop.width, crop.height].every(x => typeof x === 'number')) {
        image.crop(crop.x, crop.y, crop.width, crop.height);
        // Apply standard resize if requested
        if (crop.want_resize) {
            finalWidth = AVATAR_WIDTH;
            finalHeight = AVATAR_HEIGHT;
        } else {
            finalWidth = crop.width;
            finalHeight = crop.height;
        }
    }

    return image.cover(finalWidth, finalHeight).getBufferAsync(jimp.MIME_PNG);
}

/**
 * Reads an image file and applies crop if defined.
 * @param {string} imgPath Path to the image file
 * @param {Crop|undefined} crop Crop parameters
 * @returns {Promise<Buffer>} Image buffer
 */
async function tryReadImage(imgPath, crop) {
    try {
        let rawImg = await jimp.read(imgPath);
        let finalWidth = rawImg.bitmap.width, finalHeight = rawImg.bitmap.height;

        // Apply crop if defined
        if (typeof crop == 'object' && [crop.x, crop.y, crop.width, crop.height].every(x => typeof x === 'number')) {
            rawImg = rawImg.crop(crop.x, crop.y, crop.width, crop.height);
            // Apply standard resize if requested
            if (crop.want_resize) {
                finalWidth = AVATAR_WIDTH;
                finalHeight = AVATAR_HEIGHT;
            } else {
                finalWidth = crop.width;
                finalHeight = crop.height;
            }
        }

        const image = await rawImg.cover(finalWidth, finalHeight).getBufferAsync(jimp.MIME_PNG);
        return image;
    }
        // If it's an unsupported type of image (APNG) - just read the file as buffer
    catch {
        return fs.readFileSync(imgPath);
    }
}

function tryParse(str) {
    try {
        return JSON.parse(str);
    } catch {
        return undefined;
    }
}

/**
 * @param {String} url
 * @returns {String | null } UUID of the character
 */
function getUuidFromUrl(url) {
    // Extract UUID from URL
    const uuidRegex = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;
    const matches = url.match(uuidRegex);

    // Check if UUID is found
    const uuid = matches ? matches[0] : null;
    return uuid;
}

/**
 * Filter to get the domain host of a url instead of a blanket string search.
 * @param {String} url URL to strip
 * @returns {String} Domain name
 */
function getHostFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return '';
    }
}

/**
 * Checks if host is part of generic download source whitelist.
 * @param {String} host Host to check
 * @returns {boolean} If the host is on the whitelist.
 */
function isHostWhitelisted(host) {
    return WHITELIST_GENERIC_URL_DOWNLOAD_SOURCES.includes(host);
}

/**
 *
 * @param {Router} router
 */
export async function init(router) {
    // Used to check if the server plugin is running
    router.post('/probe', (_req, res) => {
        return res.sendStatus(204);
    });

    router.post('/edit-avatar', urlencodedParser , async function (req, res) {
        try {
            if (!req.body || !req.file) return res.status(400).send('Error: no response body and/or file detected');

            const crop = tryParse(req.query.crop);
            const uploadPath = path.join(req.file.destination, req.file.filename);

            await replaceAvatar(uploadPath, req, crop);
            fs.unlinkSync(uploadPath);

            return res.sendStatus(200);
        } catch (err) {
            console.error('An error occured, character avatar replacement invalidated.', err);
        }
    });

    router.post('/importURL', jsonParser, async (request, response) => {
        if (!request.body.url) {
            return response.sendStatus(400);
        }

        try {
            const url = request.body.url;
            const host = getHostFromUrl(url);
            let result;
            let type;

            const isChub = host.includes('chub.ai') || host.includes('characterhub.org');
            const isJannnyContent = host.includes('janitorai');
            const isPygmalionContent = host.includes('pygmalion.chat');
            const isAICharacterCardsContent = host.includes('aicharactercards.com');
            const isRisu = host.includes('realm.risuai.net');
            const isGeneric = isHostWhitelisted(host);

            const uuidOrParsed = (() => {
                if (isPygmalionContent || isJannnyContent || isRisu) {
                    return getUuidFromUrl(url);
                } else if (isAICharacterCardsContent) {
                    return parseAICC(url);
                } else if (isChub) {
                    return parseChubUrl(url);
                }
                return null;
            })();

            if (!uuidOrParsed) {
                return response.sendStatus(404);
            }

            switch (true) {
                case isPygmalionContent:
                    type = 'character';
                    result = await downloadPygmalionCharacter(uuidOrParsed);
                    break;
                case isJannnyContent:
                    type = 'character';
                    result = await downloadJannyCharacter(uuidOrParsed);
                    break;
                case isAICharacterCardsContent:
                    type = 'character';
                    result = await downloadAICCCharacter(uuidOrParsed);
                    break;
                case isChub:
                    type = uuidOrParsed?.type;
                    if (type === 'character') {
                        console.log('Downloading chub character:', uuidOrParsed.id);
                        result = await downloadChubCharacter(uuidOrParsed.id);
                    } else if (type === 'lorebook') {
                        console.log('Downloading chub lorebook:', uuidOrParsed.id);
                        result = await downloadChubLorebook(uuidOrParsed.id);
                    } else {
                        return response.sendStatus(404);
                    }
                    break;
                case isRisu:
                    type = 'character';
                    result = await downloadRisuCharacter(uuidOrParsed);
                    break;
                case isGeneric:
                    console.log('Downloading from generic url.');
                    type = 'character';
                    result = await downloadGenericPng(url);
                    break;
                default:
                    return response.sendStatus(404);
            }

            if (!result) {
                return response.sendStatus(404);
            }

            if (result.fileType) response.set('Content-Type', result.fileType);
            response.set('Content-Disposition', `attachment; filename="${encodeURI(result.fileName)}"`);
            response.set('X-Custom-Content-Type', type);
            return response.send(result.buffer);
        } catch (error) {
            console.log('Importing custom content failed', error);
            return response.sendStatus(500);
        }
    });

    router.post('/importUUID', jsonParser, async (request, response) => {
        if (!request.body.url) {
            return response.sendStatus(400);
        }

        try {
            const uuid = request.body.url;
            let result;

            const isJannny = uuid.includes('_character');
            const isPygmalion = (!isJannny && uuid.length == 36);
            const isAICC = uuid.startsWith('AICC/');
            const uuidType = uuid.includes('lorebook') ? 'lorebook' : 'character';

            switch (true) {
                case isPygmalion:
                    console.log('Downloading Pygmalion character:', uuid);
                    result = await downloadPygmalionCharacter(uuid);
                    break;
                case isJannny:
                    console.log('Downloading Janitor character:', uuid.split('_')[0]);
                    result = await downloadJannyCharacter(uuid.split('_')[0]);
                    break;
                case isAICC:
                    const [, author, card] = uuid.split('/');
                    console.log('Downloading AICC character:', `${author}/${card}`);
                    result = await downloadAICCCharacter(`${author}/${card}`);
                    break;
                default:
                    switch (uuidType) {
                        case 'character':
                            console.log('Downloading chub character:', uuid);
                            result = await downloadChubCharacter(uuid);
                            break;
                        case 'lorebook':
                            console.log('Downloading chub lorebook:', uuid);
                            result = await downloadChubLorebook(uuid);
                            break;
                        default:
                            return response.sendStatus(404);
                    }
            }

            if (result.fileType) response.set('Content-Type', result.fileType);
            response.set('Content-Disposition', `attachment; filename="${result.fileName}"`);
            response.set('X-Custom-Content-Type', uuidType);
            return response.send(result.buffer);
        } catch (error) {
            console.log('Importing custom content failed', error);
            return response.sendStatus(500);
        }
    });
}

export async function exit() {}

const module = {
    init,
    exit,
    info: {
        id: 'avataredit',
        name: 'AvatarEdit',
        description: 'Add a path to edit only avatar.',
    },
};
export default module;
