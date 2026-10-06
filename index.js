const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    downloadMediaMessage, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegPath);
process.env.PATH = `${ffmpegPath};${process.env.PATH}`;

// Função para comprimir e converter vídeos/GIFs direto pelo FFmpeg
function compressVideo(inputBuffer) {
    return new Promise((resolve, reject) => {
        const tempId = crypto.randomBytes(8).toString('hex');
        const inputPath = path.join(__dirname, `temp_in_${tempId}.mp4`);
        const outputPath = path.join(__dirname, `temp_out_${tempId}.webp`);

        fs.writeFileSync(inputPath, inputBuffer);

        ffmpeg(inputPath)
            .setDuration(5) // Limita a no máximo 5 segundos
            .fps(10)        // Reduz a 10 quadros por segundo
            .videoFilters('scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2') // Corrigido para .videoFilters
            .outputOptions([
                '-vcodec', 'libwebp',
                '-lossless', '0',
                '-compression_level', '6',
                '-q:v', '30',  // Qualidade da compressão (reduz peso)
                '-loop', '0',
                '-preset', 'default'
            ])
            .toFormat('webp')
            .on('end', () => {
                const outputBuffer = fs.readFileSync(outputPath);
                // Limpa arquivos temporários
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                resolve(outputBuffer);
            })
            .on('error', (err) => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                reject(err);
            })
            .save(outputPath);
    });
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 Escaneie o QR Code abaixo:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Bot de figurinhas (Com compressor WebP) rodando com sucesso!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const messageType = Object.keys(msg.message)[0];
        const isVideo = messageType === 'videoMessage';
        
        const caption = msg.message[messageType]?.caption?.toLowerCase().trim() || '';
        const conversation = msg.message?.conversation?.toLowerCase().trim() || '';

        const isCommand = caption === '!figurinha' || caption === '!sticker' || 
                          conversation === '!figurinha' || conversation === '!sticker';

        if (isCommand) {
            try {
                console.log('📥 Baixando mídia...');
                const buffer = await downloadMediaMessage(msg, 'buffer', {});

                let stickerBuffer;

                if (isVideo) {
                    console.log('⚡ Comprimindo e convertendo vídeo/GIF via FFmpeg...');
                    stickerBuffer = await compressVideo(buffer);
                } else {
                    console.log('🎨 Convertendo imagem estática...');
                    const sticker = new Sticker(buffer, {
                        pack: 'Meu Bot',
                        author: 'Criador',
                        type: StickerTypes.CROP,
                        quality: 70
                    });
                    stickerBuffer = await sticker.toBuffer();
                }

                const finalSizeKB = (stickerBuffer.length / 1024).toFixed(2);
                console.log(`📏 Tamanho final da figurinha: ${finalSizeKB} KB`);

                console.log('📤 Enviando figurinha...');
                await sock.sendMessage(msg.key.remoteJid, { sticker: stickerBuffer }, { quoted: msg });
                console.log('✅ Figurinha enviada com sucesso!');
            } catch (error) {
                console.error('❌ Erro ao processar mídia:', error.message || error);
                await sock.sendMessage(msg.key.remoteJid, { 
                    text: '❌ Não foi possível converter este vídeo.' 
                }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();