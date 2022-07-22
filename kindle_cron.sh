#!/bin/bash

KINDLE_IP=192.168.15.244

ifconfig usb0 192.168.15.201

script_path=$(dirname "$(readlink -f "$0")")

# Disable Kindle services
ssh root@$KINDLE_IP /sbin/stop lab126_gui # Basic UI as it's not needed
ssh root@$KINDLE_IP /sbin/stop powerd # Should prevent screensaver and background LEDs
# There might be other suitable to stop, see https://github.com/mattzzw/kindle-gphotos/blob/master/kindle-gphotos.sh
# stop otaupd
# stop phd
# stop tmd
# stop x
# stop todo
# stop mcsd
# stop archive
# stop dynconfig
# stop dpmd
# stop appmgrd
# stop stackdumpd

# Display chart on Kindle
scp "${script_path}/data/databot/current.png" root@$KINDLE_IP:/var/tmp/root
ssh root@$KINDLE_IP /usr/sbin/eips -f -g /var/tmp/root/current.png