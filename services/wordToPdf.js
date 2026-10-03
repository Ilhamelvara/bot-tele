const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

function getLibreOfficePath() {
    // Linux / Docker
    if (process.platform === "linux") {
        const linuxCandidates = [
            "/usr/bin/libreoffice",
            "/usr/bin/soffice",
            "/usr/local/bin/libreoffice",
            "/usr/local/bin/soffice",
        ];
        for (const candidate of linuxCandidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return "soffice";
    }

    // Windows
    const candidates = [
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
        "C:\\Program Files\\LibreOffice\\program\\soffice.com",
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
        "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function wordToPdf(inputPath, outputDir) {
    return new Promise((resolve, reject) => {
        const sofficePath = getLibreOfficePath();

        if (!sofficePath) {
            return reject(
                new Error("LibreOffice tidak ditemukan.")
            );
        }

        const profileDir = path.join(
            outputDir,
            `lo-profile-${Date.now()}`
        );

        fs.mkdirSync(profileDir, {
            recursive: true,
        });

        const normalizedProfile = profileDir.replace(/\\/g, "/");
        const profileUrl = normalizedProfile.startsWith("/")
            ? `file://${normalizedProfile}`
            : `file:///${normalizedProfile}`;

        const args = [
            "--headless",
            "--invisible",
            "--nodefault",
            "--nofirststartwizard",
            `-env:UserInstallation=${profileUrl}`,
            "--convert-to",
            "pdf",
            "--outdir",
            outputDir,
            inputPath,
        ];

        execFile(
            sofficePath,
            args,
            {
                windowsHide: true,
            },
            (error, stdout, stderr) => {
                try {
                    if (fs.existsSync(profileDir)) {
                        fs.rmSync(profileDir, {
                            recursive: true,
                            force: true,
                        });
                    }
                } catch (cleanupError) {
                    console.error("Gagal menghapus profile:", cleanupError);
                }
                if (error) {
                    console.error("LibreOffice error:", stderr);
                    return reject(error);
                }

                console.log("LibreOffice:", stdout);

                const fileName = path.basename(
                    inputPath,
                    path.extname(inputPath)
                );

                const outputPath = path.join(
                    outputDir,
                    `${fileName}.pdf`
                );

                if (!fs.existsSync(outputPath)) {
                    return reject(
                        new Error("File PDF hasil konversi tidak ditemukan.")
                    );
                }

                resolve(outputPath);
            }
        );
    });
}

module.exports = wordToPdf;