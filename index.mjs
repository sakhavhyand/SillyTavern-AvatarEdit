import { Router } from 'express';
import jimp from 'jimp';
import { createRequire } from 'module';
import { AVATAR_HEIGHT, AVATAR_WIDTH } from '../../src/constants.js';
import { invalidateThumbnail } from '../../src/endpoints/thumbnails.js';
import { urlencodedParser } from '../../src/express-common.js';
const require  = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const characterCardParser = require('../../src/character-card-parser.js');
const writeFileAtomicSync = require('write-file-atomic').sync;


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

        writeFileAtomicSync(imagePath, outputImage);
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
    // Used to check if the server plugin is running
    router.post('/probe', (_req, res) => {
        return res.sendStatus(204);
    });
    router.post('/edit-avatar', urlencodedParser , async function (req, res) {
        try {
            if (!req.body || !req.file) return res.status(400).send('Error: no response body and/or file detected');

            console.log('file received.');
            const crop = tryParse(req.query.crop);
            const uploadPath = path.join(req.file.destination, req.file.filename);

            await replaceAvatar(uploadPath, req, crop);
            fs.unlinkSync(uploadPath);

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
