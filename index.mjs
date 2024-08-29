import { Router } from 'express';
import jimp from 'jimp';
const path = import('path');
import { AVATAR_HEIGHT, AVATAR_WIDTH } from '../../src/constants.js';
import { invalidateThumbnail } from '../../src/endpoints/thumbnails.js';
const fs = import('fs');
import { urlencodedParser } from '../../src/express-common.js';
const characterCardParser = import('../../src/character-card-parser.js');
const writeFileAtomicSync = import('write-file-atomic').sync;


async function replaceAvatar(filename, file, crop = undefined) {
    try {
        const charData = req.body.char;
        const avatarPath = path.join(req.user.directories.characters, charData.avatar);
        invalidateThumbnail(req.user.directories, 'avatar', charData.avatar);
        function getInputImage() {
            if (Buffer.isBuffer(req.body.avatar)) {
                return parseImageBuffer(req.body.avatar, crop);
            }

            return tryReadImage(req.body.avatar, crop);
        }

        const inputImage = await getInputImage();
        const outputImage = characterCardParser.write(inputImage, charData);

        writeFileAtomicSync(avatarPath, outputImage);
        return true;
    } catch (err) {
        console.log(err);
        return false;
    }
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
 *
 * @param {Router} router
 */
export async function init(router) {
    router.post('/edit-avatar', urlencodedParser , async function (req, res) {
        if (!req.body || !req.file) {
            console.error('Error: no response body and/or file detected');
            return res.status(400).send('Error: no response body and/or file detected');
        }

        try {
            console.log('file received.');
            // const crop = tryParse(req.query.crop);
            // console.log(req.body.avatar_url);
            // console.log(crop);
            // replaceAvatar(req.body.avatar_url, req.file, crop);
            return res.sendStatus(200);
        } catch (err) {
            console.error('An error occured, character avatar replacement invalidated.', err);
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
