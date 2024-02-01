FROM --platform=linux/amd64 ubuntu 
RUN apt-get update && apt-get install apache2 apache2-utils -y
RUN apt clean 
EXPOSE 80
CMD ["/usr/sbin/apache2ctl", "-D", "FOREGROUND"]