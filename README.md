# Homebase

Raspberry Pi based home monitoring dashboard

## Setup

### Raspberry Pi

1. Install `Raspberry Pi OS Lite (64-Bit)`
2. Install `Docker` (see [Install Docker Engine on Debian](https://docs.docker.com/engine/install/debian/#install-using-the-convenience-script) for latest instructions, at this time the _Install using the convenience script_ section must be used for Raspberry Pi):

   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh

   # Let the logged-in user use `docker` without `sudo`
   sudo usermod -aG docker ${USER}
   ```

3. (Optional) Make Raspian OS auto-update itself (confirm with `Yes` in the configuration)

   ```bash
   sudo apt-get install unattended-upgrades keychain # keychain for password protected ssh keys
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```

4. Prepare Kindle (see below)

5. Setup USB network with Kindle (must be attached and prepared with `USBNetwork`)

   > TODO: Make`ifconfig usb0 ...` better since it's always set in the cron job, maybe [https://www.mobileread.com/forums/showthread.php?t=342904](https://www.mobileread.com/forums/showthread.php?t=342904) helps.

   On the raspberry add the following with `sudo nano /etc/dhcpcd.conf`:

   ```
   # Kindle via USBNetwork
   interface usb0
   static ip_address=192.168.15.244/24
   static routers=192.168.15.1
   ```

   Then `sudo reboot`.

   Generate a ssh keypair with

   ```
   ssh-keygen -t ed25519
   ```

   If you're using a password you can add it to `ssh-agent`:

   ```
   ssh-add ~/.ssh/id_ed25519
   ```

   This key must be added to the Kindle (see below).

   Start the interface with (actually only needed if you want to manually ssh into the Kindle. It's handled by the cron job)

   ```
   sudo ifconfig usb0 192.168.15.201
   ```

   Make the the kindle cron script executable with `chmod u+x <absolute path to clone git repot>/kindle_cron.sh` add following cronjob with `crontab -e`:

   ```
   */15 * * * * <absolute path to clone git repot>/kindle_cron.sh
   ```

### App

Clone this repo and create a `./.env` in the app folder with following content:

```bash
USERNAME=...
PASSWORD=...
METER_ID=...
INFLUX_ORG=ulrichlehner
INFLUX_BUCKET=smartmeter
INFLUX_TOKEN=<genereate a secure token string>
TZ=Europe/Vienna
DOCKER_INFLUXDB_INIT_USERNAME=admin
DOCKER_INFLUXDB_INIT_PASSWORD=<generate a secure password>
DOCKER_INFLUXDB_INIT_ORG=ulrichlehner
DOCKER_INFLUXDB_INIT_BUCKET=smartmeter
DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=<genereate a secure token string>
```

The variables `INFLUX_BUCKET` and `DOCKER_INFLUXDB_INIT_BUCKET` must have the same value, as well as `INFLUX_TOKEN` = `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN` and `INFLUX_ORG` = `DOCKER_INFLUXDB_INIT_ORG`.

### Kindle

#### Kindle Paperwhite 5th Generation (EY21) w/ firmware 5.6.1.1 jailbreak

**These instructions are only tested with the software and hardware version as above! If you have a different hardware / software setup you'll have to find instructions for your case.**

- The firmware _5.6.1.1_ has to be downgraded following these instructions [How to Downgrade PW 1 ca from 5.6.1.1 to 5.3.3 and maybe PW2](http://www.mobileread.mobi/forums/showthread.php?t=264432).

  - Keep WiFi off / enable airplane mode
  - Download the firmare _5.3.3_ [https://s3.amazonaws.com/G7G_FirmwareUpdates_WebDownloads/update_kindle_5.3.3.bin](https://s3.amazonaws.com/G7G_FirmwareUpdates_WebDownloads/update_kindle_5.3.3.bin) and upload it via USB to the Kindle's root folder (if it doesn't work you might try version _5.3.1_ via [http://kindle.s3.amazonaws.com/update_kindle_5.3.1.bin](http://kindle.s3.amazonaws.com/update_kindle_5.3.1.bin))
  - Push and hold power button the device restarts (you can release the button when the power LED turned off) and wait for the update (**keep the device connected to the computer until the update is done!**)

- Install the jailbreak as described in [Kindle Touch/PW1/PW2 5.0.x - 5.4.4.2 JailBreak. Plus FW 5.x USBNetwork](https://www.mobileread.com/forums/showthread.php?t=186645).

  - Download [https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/Touch/kindle-jailbreak-1.16.N-r18869.tar.xz](https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/Touch/kindle-jailbreak-1.16.N-r18869.tar.xz)
  - Unpack `kindle-5.4-jailbreak.zip` and upload the **files of the extracted folder** to the Kindle's root directory
  - Disconnect the USB and _Update Kindle_ from the settings
  - If it worked you should see the message `**** JAILBREAK ****` appear :)

- Install _KUAL_ (maybe also _KUAL+_)

  - Download [https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/KUAL/KUAL-v2.7.26-g32b2e39-20220213.tar.xz](https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/KUAL/KUAL-v2.7.26-g32b2e39-20220213.tar.xz)
  - Extract and put `KUAL-KDK-2.0.azw2` into Kindles `documents` folder
  - Open the new "book"

- Install _MR Package Installer_

  - Download [https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/KUAL/kual-mrinstaller-1.7.N-r18896.tar.xz](https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/KUAL/kual-mrinstaller-1.7.N-r18896.tar.xz)
  - Extract and put `extensions` (with `MRInstaller`) into Kindle's root folder (or replace / merge the `extensions` folder if it exists)

- Install the _USB Network_ hack
  - Download [https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/Touch/kindle-usbnet-0.22.N-r18897.tar.xz](https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/Touch/kindle-usbnet-0.22.N-r18897.tar.xz)
  - Upload the file `Update_usbnet_0.22.N_install_touch_pw.bin` to the Kindle's root `mrpackages` folder (create it if it doesn't exist)
  - Open `KUAL` app and use the `Helper / Install MR Packagages` action
  - There should be `USBNetwork` listed in `KUAL`

#### Setup

- Apply following settings in `KUAL / USBNetwork`:

  ```
  Enable SSH at boot
  Make dropbear quiet
  Toggle USB Network
  ```

- Add the Rasperry Pi's public SSH key to `/mnt/us/etc/authorized_keys` (the file must be created manually if it doesn't exist)

#### Useful links

- [https://wiki.mobileread.com/wiki/Kindle_Serial_Numbers](https://wiki.mobileread.com/wiki/Kindle_Serial_Numbers)
- [Kindle Touch/PW1/PW2 5.0.x - 5.4.4.2 JailBreak. Plus FW 5.x USBNetwork.](https://www.mobileread.com/forums/showthread.php?t=186645)
- [Kindle Touch Hacking](https://wiki.mobileread.com/wiki/Kindle_Touch_Hacking#CURRENT_UNIVERSAL_METHOD)

## Run

```bash
docker compose up --build
```

## Manually migrate data

Although a migration is performed when smartmeter data is fetched the first time, you can trigger a manual migration with following command:

```bash
docker compose run --rm databot pipenv run python3 load.py --migrate
```

## Flux queries

Query all data:

```
from(bucket: "smartmeter")
  |> range(start: v.timeRangeStart, stop:v.timeRangeStop)
  |> filter(fn: (r) =>
    r._measurement == "meteredValues" and
    r._field == "value"
  )
```

Split in 6h time windows:

```
from(bucket: "smartmeter")
  |> range(start: v.timeRangeStart, stop:v.timeRangeStop)
  |> filter(fn: (r) =>
    r._measurement == "meteredValues" and
    r._field == "value"
  )
  |> aggregateWindow(every: 6h, offset: -12h, fn: mean)
```

```
from(bucket: "smartmeter")
  |> range(start: time(v: "2022-07-10T23:45:00Z"), stop: time(v: "2022-07-18T00:00:00Z"))
  |> filter(fn: (r) =>
    r._measurement == "meteredValues" and
    r._field == "value"
  )
  //|> aggregateWindow(every: 6h, createEmpty: false, offset: -12h, fn: mean)
  //|> count()
```
