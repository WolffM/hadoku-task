#include "sessionmanager.h"

#include "logging.h"

#include <KWallet>

#include <QFile>
#include <QSettings>
#include <QStandardPaths>

#include <memory>

SessionManager::SessionManager(QObject *parent)
    : QObject(parent)
{
}

QString SessionManager::userKey() const
{
    using KWallet::Wallet;

    // 1. KWallet (preferred secure store).
    qCInfo(HadokuTask) << "SessionManager: resolving userKey; KWallet enabled =" << Wallet::isEnabled();
    if (Wallet::isEnabled()) {
        std::unique_ptr<Wallet> wallet(
            Wallet::openWallet(Wallet::NetworkWallet(), 0, Wallet::Synchronous));
        if (wallet && wallet->isOpen()) {
            const QString folder = QStringLiteral("hadoku-task");
            const bool has = wallet->hasFolder(folder);
            qCInfo(HadokuTask) << "SessionManager: wallet open; hasFolder(hadoku-task) =" << has;
            if (has && wallet->setFolder(folder)) {
                QString value;
                if (wallet->readPassword(QStringLiteral("userKey"), value) == 0 && !value.isEmpty()) {
                    qCInfo(HadokuTask) << "SessionManager: userKey from KWallet, length" << value.size();
                    return value;
                }
            }
        } else {
            qCInfo(HadokuTask) << "SessionManager: wallet not open; falling back to config file";
        }
    }

    // 2. Dev fallback: <config>/hadoku-task.conf, [Auth] UserKey.
    const QString path =
        QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation)
        + QStringLiteral("/hadoku-task.conf");
    QSettings settings(path, QSettings::IniFormat);
    const QString key = settings.value(QStringLiteral("Auth/UserKey")).toString();
    qCInfo(HadokuTask) << "SessionManager: config" << path << "exists =" << QFile::exists(path)
                       << "; userKey length" << key.size();
    return key;
}

static QString configPath()
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation)
           + QStringLiteral("/hadoku-task.conf");
}

void SessionManager::setUserKey(const QString &key)
{
    const QString trimmed = key.trimmed();
    QSettings settings(configPath(), QSettings::IniFormat);
    settings.setValue(QStringLiteral("Auth/UserKey"), trimmed);
    settings.sync();
    QFile::setPermissions(configPath(), QFile::ReadOwner | QFile::WriteOwner);

    // Best-effort: also store in KWallet so the secure store stays authoritative.
    using KWallet::Wallet;
    if (Wallet::isEnabled()) {
        std::unique_ptr<Wallet> wallet(
            Wallet::openWallet(Wallet::NetworkWallet(), 0, Wallet::Synchronous));
        if (wallet && wallet->isOpen()) {
            const QString folder = QStringLiteral("hadoku-task");
            if (!wallet->hasFolder(folder))
                wallet->createFolder(folder);
            if (wallet->setFolder(folder))
                wallet->writePassword(QStringLiteral("userKey"), trimmed);
        }
    }
    qCInfo(HadokuTask) << "SessionManager: userKey updated, length" << trimmed.size();
}

QStringList SessionManager::pinnedBoards() const
{
    QSettings settings(configPath(), QSettings::IniFormat);
    return settings.value(QStringLiteral("Boards/Pinned")).toStringList();
}

void SessionManager::setPinnedBoards(const QStringList &ids)
{
    QSettings settings(configPath(), QSettings::IniFormat);
    settings.setValue(QStringLiteral("Boards/Pinned"), ids);
    settings.sync();
    qCInfo(HadokuTask) << "SessionManager: pinned boards =" << ids;
}
